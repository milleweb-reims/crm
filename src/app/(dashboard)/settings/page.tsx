"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import {
  Plus,
  Trash2,
  Shield,
  ShieldCheck,
  Code,
  UserX,
  UserCheck,
  UserCog,
} from "lucide-react";
import { Header } from "@/components/header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { IUser, UserRole } from "@/types";

const roleConfig: Record<UserRole, { label: string; icon: React.ElementType; color: "violet" | "blue" | "orange" }> = {
  admin: { label: "Admin", icon: ShieldCheck, color: "violet" },
  closer: { label: "Closer", icon: Shield, color: "blue" },
  dev: { label: "Dev", icon: Code, color: "orange" },
};

/** Ce que la suppression d'un compte va emporter, renvoyé par /api/users/[id]/impact. */
interface DeletionImpact {
  readonly prospects: number;
  readonly locks: number;
  readonly reminders: number;
  readonly activities: number;
}

function ImpactRow({ count, label }: Readonly<{ count: number; label: string }>) {
  return (
    <li className="flex items-baseline gap-2">
      <span className="font-semibold text-foreground tabular-nums">{count}</span>
      <span>{label}</span>
    </li>
  );
}

export default function SettingsPage() {
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === "admin";
  // Pendant une substitution, `session.user` est le compte visé : proposer une
  // nouvelle substitution depuis cet écran n'aurait pas de sens. On revient
  // d'abord à son compte via le bandeau.
  const canImpersonate = isAdmin && !session?.impersonator;

  const [users, setUsers] = useState<IUser[]>([]);
  const [loading, setLoading] = useState(true);

  // New user form
  const [showForm, setShowForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<UserRole>("closer");
  const [formError, setFormError] = useState("");

  // Suppression définitive : compte visé, impact chiffré et repreneur éventuel
  const [deleteTarget, setDeleteTarget] = useState<IUser | null>(null);
  const [impact, setImpact] = useState<DeletionImpact | null>(null);
  const [impactLoading, setImpactLoading] = useState(false);
  const [reassignTo, setReassignTo] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  // Compte dont on attend le récapitulatif : une réponse tardive concernant un
  // autre compte doit être ignorée.
  const pendingImpactFor = useRef<string | null>(null);

  // Password change
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [pwdMsg, setPwdMsg] = useState("");

  const loadUsers = useCallback(async () => {
    const res = await fetch("/api/users");
    return res.ok ? ((await res.json()) as IUser[]) : null;
  }, []);

  const fetchUsers = useCallback(() => {
    loadUsers()
      .then((fetched) => {
        if (fetched) setUsers(fetched);
      })
      .catch(() => {
        // Network unavailable: user can retry via any action
      })
      .finally(() => setLoading(false));
  }, [loadUsers]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  async function handleCreateUser(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");

    const res = await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: newName,
        email: newEmail,
        password: newPassword,
        role: newRole,
      }),
    });

    if (!res.ok) {
      const data = await res.json();
      setFormError(data.error || "Erreur");
      return;
    }

    setNewName("");
    setNewEmail("");
    setNewPassword("");
    setNewRole("closer");
    setShowForm(false);
    fetchUsers();
  }

  /**
   * Désactive ou réactive un compte. Un compte désactivé ne peut plus se
   * connecter et ses sessions ouvertes sont invalidées à la requête suivante.
   */
  async function handleToggleActive(user: IUser) {
    setFormError("");
    const res = await fetch(`/api/users/${user._id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !user.isActive }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setFormError(data.error || "Erreur lors de la mise à jour");
    }
    fetchUsers();
  }

  /**
   * Prend l'identité d'un compte. Rechargement complet plutôt que navigation
   * côté client : la substitution est portée par un cookie lu côté serveur, et
   * SessionProvider garde la session en cache tant que le document n'est pas
   * rechargé.
   */
  async function handleImpersonate(user: IUser) {
    setFormError("");

    const res = await fetch("/api/impersonation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: user._id }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setFormError(data.error || "Substitution impossible");
      return;
    }

    window.location.assign("/");
  }

  function openDeleteModal(user: IUser) {
    setDeleteTarget(user);
    setImpact(null);
    setImpactLoading(true);
    setReassignTo("");
    setDeleteError("");
    pendingImpactFor.current = user._id;

    fetch(`/api/users/${user._id}/impact`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: DeletionImpact | null) => {
        if (pendingImpactFor.current !== user._id) return;
        setImpact(data);
        setImpactLoading(false);
      })
      .catch(() => {
        if (pendingImpactFor.current !== user._id) return;
        setImpactLoading(false);
      });
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError("");

    const query = reassignTo ? `?reassignTo=${reassignTo}` : "";
    const res = await fetch(`/api/users/${deleteTarget._id}${query}`, {
      method: "DELETE",
    });
    setDeleting(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setDeleteError(data.error || "Erreur lors de la suppression");
      return;
    }

    setDeleteTarget(null);
    fetchUsers();
  }

  // Repreneurs possibles : comptes actifs hors devs (un dev ne traite pas de
  // prospects) et hors compte supprimé.
  const transferCandidates = users.filter(
    (u) => u.isActive && u.role !== "dev" && u._id !== deleteTarget?._id
  );

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwdMsg("");

    if (!session?.user?.id) return;

    const res = await fetch(`/api/users/${session.user.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: newPwd }),
    });

    if (res.ok) {
      setPwdMsg("Mot de passe mis à jour");
      setCurrentPassword("");
      setNewPwd("");
    } else {
      setPwdMsg("Erreur lors de la mise à jour");
    }
  }

  void currentPassword; // Not used in MVP but kept for future auth check

  return (
    <>
      <Header title="Paramètres" />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* User management - admin only */}
        {isAdmin && (
          <Card className="lg:col-span-2">
            <div className="flex items-center justify-between mb-4">
              <CardTitle>Utilisateurs</CardTitle>
              <Button size="sm" onClick={() => setShowForm(!showForm)}>
                <Plus className="h-4 w-4" />
                Ajouter
              </Button>
            </div>

            {/* Create form */}
            {showForm && (
              <form
                onSubmit={handleCreateUser}
                className="mb-6 p-4 bg-muted/50 rounded-lg space-y-3"
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Input
                    placeholder="Nom"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    required
                  />
                  <Input
                    type="email"
                    placeholder="Email"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    required
                  />
                  <Input
                    type="password"
                    placeholder="Mot de passe"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                    minLength={8}
                  />
                  <select
                    value={newRole}
                    onChange={(e) => setNewRole(e.target.value as UserRole)}
                    className="h-10 rounded-lg border border-border bg-background px-3 text-sm"
                  >
                    <option value="closer">Closer</option>
                    <option value="dev">Dev</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
                {formError && (
                  <p className="text-sm text-red-600">{formError}</p>
                )}
                <div className="flex gap-2">
                  <Button type="submit" size="sm">
                    Créer
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setShowForm(false)}
                  >
                    Annuler
                  </Button>
                </div>
              </form>
            )}

            {/* Users table */}
            <CardContent>
              {loading ? (
                <div className="flex justify-center py-8">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left py-2 font-medium text-muted-foreground">
                          Nom
                        </th>
                        <th className="text-left py-2 font-medium text-muted-foreground hidden sm:table-cell">
                          Email
                        </th>
                        <th className="text-left py-2 font-medium text-muted-foreground">
                          Rôle
                        </th>
                        <th className="text-left py-2 font-medium text-muted-foreground hidden sm:table-cell">
                          Statut
                        </th>
                        <th className="text-right py-2 font-medium text-muted-foreground">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {users.map((user) => {
                        const config = roleConfig[user.role];
                        return (
                          <tr key={user._id} className="border-b border-border last:border-0">
                            <td className="py-3">
                              <span className="font-medium">{user.name}</span>
                              <span className="block sm:hidden text-xs text-muted-foreground mt-0.5">{user.email}</span>
                            </td>
                            <td className="py-3 text-muted-foreground hidden sm:table-cell">{user.email}</td>
                            <td className="py-3">
                              <Badge variant={config.color}>{config.label}</Badge>
                            </td>
                            <td className="py-3 hidden sm:table-cell">
                              <Badge variant={user.isActive ? "green" : "gray"}>
                                {user.isActive ? "Actif" : "Inactif"}
                              </Badge>
                            </td>
                            <td className="py-3 text-right">
                              {user._id !== session?.user?.id && (
                                <div className="flex items-center justify-end gap-1">
                                  {canImpersonate && (
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-8 w-8"
                                      title={
                                        user.isActive
                                          ? `Se substituer à ${user.name} — voir et agir en son nom`
                                          : "Compte désactivé : substitution impossible"
                                      }
                                      disabled={!user.isActive}
                                      onClick={() => handleImpersonate(user)}
                                      data-test={`impersonate-${user._id}`}
                                    >
                                      <UserCog className="h-4 w-4" />
                                    </Button>
                                  )}
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8"
                                    title={
                                      user.isActive
                                        ? "Désactiver (le compte ne peut plus se connecter)"
                                        : "Réactiver le compte"
                                    }
                                    onClick={() => handleToggleActive(user)}
                                    data-test={`toggle-active-${user._id}`}
                                  >
                                    {user.isActive ? (
                                      <UserX className="h-4 w-4" />
                                    ) : (
                                      <UserCheck className="h-4 w-4 text-green-600" />
                                    )}
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-destructive"
                                    title="Supprimer définitivement"
                                    onClick={() => openDeleteModal(user)}
                                    data-test={`delete-user-${user._id}`}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

            </CardContent>
          </Card>
        )}

        {/* Change password */}
        <Card>
          <CardTitle>Changer le mot de passe</CardTitle>
          <CardContent className="mt-4">
            <form onSubmit={handleChangePassword} className="space-y-3">
              <Input
                type="password"
                placeholder="Nouveau mot de passe"
                value={newPwd}
                onChange={(e) => setNewPwd(e.target.value)}
                required
                minLength={8}
              />
              {pwdMsg && (
                <p
                  className={`text-sm ${
                    pwdMsg.includes("Erreur") ? "text-red-600" : "text-green-600"
                  }`}
                >
                  {pwdMsg}
                </p>
              )}
              <Button type="submit" size="sm">
                Mettre à jour
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>

      {/* Suppression définitive : récapitulatif chiffré + choix du repreneur */}
      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteTarget(null);
        }}
      >
        <DialogContent
          className="max-h-[85vh] overflow-y-auto"
          data-test="delete-user-modal"
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Trash2 className="h-5 w-5 text-destructive" />
              Supprimer {deleteTarget?.name}
            </DialogTitle>
            <DialogDescription>
              Le compte sera définitivement supprimé et sa session en cours
              invalidée. Cette action est irréversible — pour un départ
              temporaire, préférez la désactivation.
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-lg bg-muted/50 p-4">
            <p className="text-sm font-medium text-foreground mb-2">
              Ce compte est rattaché à :
            </p>
            {impact && (
              <ul className="space-y-1 text-sm text-muted-foreground">
                <ImpactRow count={impact.prospects} label="prospects attribués" />
                <ImpactRow count={impact.locks} label="fiches verrouillées (libérées)" />
                <ImpactRow count={impact.reminders} label="rappels" />
                <ImpactRow count={impact.activities} label="entrées d'historique (conservées)" />
              </ul>
            )}
            {!impact && impactLoading && (
              <p className="text-sm text-muted-foreground">
                Calcul du récapitulatif…
              </p>
            )}
            {!impact && !impactLoading && (
              <p className="text-sm text-muted-foreground">
                Récapitulatif indisponible — la suppression reste possible.
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="reassign-to"
              className="block text-sm font-medium text-foreground mb-1.5"
            >
              Transférer prospects et rappels à
            </label>
            <select
              id="reassign-to"
              value={reassignTo}
              onChange={(e) => setReassignTo(e.target.value)}
              disabled={deleting}
              className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm"
              data-test="reassign-to"
            >
              <option value="">Personne — libérer les prospects</option>
              {transferCandidates.map((u) => (
                <option key={u._id} value={u._id}>
                  {u.name}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground mt-2">
              {reassignTo
                ? "Les prospects et les rappels changent de propriétaire. L'historique d'activité reste attaché aux fiches."
                : "Les prospects redeviennent non attribués et repartent dans le pool ; les rappels de ce compte sont supprimés."}
            </p>
          </div>

          {deleteError && (
            <p className="text-sm text-red-600">{deleteError}</p>
          )}

          <DialogFooter>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              disabled={deleting}
            >
              Annuler
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={confirmDelete}
              disabled={deleting}
              data-test="confirm-delete-user"
            >
              {deleting ? "Suppression…" : "Supprimer définitivement"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
