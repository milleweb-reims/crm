import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { compare } from "bcryptjs";
import { connectDB } from "./db";
import { resolveImpersonatedUser, stopImpersonation } from "./impersonation";
import { User } from "./models/user.model";
import type { UserRole } from "@/types";

declare module "next-auth" {
  interface User {
    role: UserRole;
  }
  interface Session {
    user: {
      id: string;
      name: string;
      email: string;
      role: UserRole;
    };
    /**
     * Présent uniquement pendant une substitution : le vrai compte derrière
     * `user`. C'est lui qui autorise l'arrêt de la substitution, et sa présence
     * déclenche le bandeau permanent côté interface.
     */
    impersonator?: {
      readonly id: string;
      readonly name: string;
      readonly email: string;
      readonly role: UserRole;
    } | null;
  }
}

declare module "next-auth" {
  interface JWT {
    id: string;
    role: UserRole;
  }
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Mot de passe", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        await connectDB();

        const user = await User.findOne({
          email: (credentials.email as string).toLowerCase(),
          isActive: true,
        });

        if (!user) return null;

        const isValid = await compare(
          credentials.password as string,
          user.passwordHash
        );

        if (!isValid) return null;

        return {
          id: user._id.toString(),
          name: user.name,
          email: user.email,
          role: user.role,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id!;
        token.role = user.role;
        return token;
      }

      // Le JWT vit 30 jours : sans cette revalidation, un compte supprimé ou
      // désactivé garderait un accès complet (lecture ET écriture) jusqu'à
      // l'expiration du jeton. On relit donc le compte à chaque requête.
      const id = token.id as string | undefined;
      if (!id) return token;

      try {
        await connectDB();
        const current = (await User.findById(id)
          .select("role isActive")
          .lean()) as { role: UserRole; isActive: boolean } | null;

        // null invalide la session et efface le cookie côté Auth.js.
        if (!current || !current.isActive) return null;

        // Un changement de rôle prend effet immédiatement, sans reconnexion.
        token.role = current.role;
      } catch {
        // Base injoignable : on conserve la session plutôt que de déconnecter
        // tout le monde sur un incident d'infrastructure.
      }

      return token;
    },
    async session({ session, token }) {
      session.user.id = token.id as string;
      session.user.role = token.role as UserRole;

      const impersonated = await resolveImpersonatedUser({
        realUserId: session.user.id,
        realRole: session.user.role,
      });

      if (!impersonated) return session;

      // L'identité effective REMPLACE celle de l'admin. C'est ce qui rend la
      // substitution complète sans toucher au reste du code : les points de
      // contrôle des routes lisent `session.user`, et `useSession` sert la même
      // chose au navigateur — sidebar, dashboard et filtres de visibilité
      // basculent donc ensemble, sans divergence possible entre les deux côtés.
      return {
        ...session,
        user: { ...session.user, ...impersonated },
        impersonator: {
          id: session.user.id,
          name: session.user.name,
          email: session.user.email,
          role: session.user.role,
        },
      };
    },
  },
  events: {
    /**
     * Une substitution ne survit pas à la déconnexion. Le préfixe du cookie la
     * rend déjà inerte pour un autre compte, mais la purger évite qu'un admin qui
     * se reconnecte se retrouve substitué sans l'avoir demandé.
     */
    async signOut() {
      // La suppression échoue si Auth.js ne peut pas écrire dans la réponse :
      // ne jamais faire échouer une déconnexion pour ça.
      await stopImpersonation().catch(() => {});
    },
  },
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
  },
});
