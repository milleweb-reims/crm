"use client";

import { useSession } from "next-auth/react";
import { ArrowRight, HelpCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  PROSPECT_STATUSES,
  DELIVERY_STAGES,
  type ProspectStatus,
  type DeliveryStage,
} from "@/types";
import { cn } from "@/lib/utils";

const STATUS_DESCRIPTIONS: Record<ProspectStatus, string> = {
  prospect:
    "Nouveau contact dans la base (import ou ajout manuel). Personne ne l'a encore appelé.",
  en_appel:
    "Un closer a la fiche en main et est au téléphone (ou en train de composer). La fiche est verrouillée pour les autres closers.",
  a_rappeler:
    "Le prospect n'a pas décroché, ou un message lui a été laissé. Le closer attitré doit le rappeler plus tard — idéalement avec un rappel daté.",
  rdv: "Un rendez-vous est fixé pour présenter la démo du site générée.",
  lien_envoye:
    "Le lien de paiement GoCardless a été envoyé au prospect. En attente du règlement.",
  paye: "Le paiement est validé : le prospect devient client, ainsi un dev prend un nom de domaine.",
  pas_interesse:
    "Le prospect a décliné l'offre. On ne le relance plus.",
};

const STAGE_DESCRIPTIONS: Record<DeliveryStage, string> = {
  a_faire:
    "Le RDV est fixé : le site n'existe pas encore et doit être construit avant la date de la démo.",
  en_cours: "Un dev construit le site en vue de la démo.",
  termine:
    "Le site est prêt pour la démo, puis mis en ligne sur son vrai domaine une fois le paiement encaissé.",
};

const STAGE_COLORS: Record<DeliveryStage, "gray" | "blue" | "green"> = {
  a_faire: "gray",
  en_cours: "blue",
  termine: "green",
};

interface CloserCopy {
  /** Ce que le closer cherche à obtenir du prospect à cette étape. */
  readonly goal: string;
  /** L'action concrète qui fait avancer la fiche. */
  readonly next: string;
}

/**
 * Version closer du guide : on n'explique pas ce que le logiciel fait, on
 * explique le but commercial de chaque statut et l'action qui suit.
 */
const CLOSER_STATUS_COPY: Record<ProspectStatus, CloserCopy> = {
  prospect: {
    goal: "Contact frais : un commerce local sans site, que personne n'a encore appelé. Ton seul objectif ici, c'est de décrocher un RDV de démo.",
    next: "Prends la fiche, appelle, déroule ton accroche.",
  },
  en_appel: {
    goal: "Tu l'as au téléphone. Le but n'est pas de vendre maintenant, mais de lui donner envie de voir le site qu'on a fait pour lui.",
    next: "S'il décroche, fixe une date et une heure précises, jamais un « rappelez-moi ». Pas de réponse ou répondeur : passe la fiche en « À rappeler » avec une date de rappel.",
  },
  a_rappeler: {
    goal: "Il n'a pas décroché, ou tu lui as laissé un message. La fiche reste à toi : personne d'autre ne l'appellera. Peu de prospects signent au premier appel — cette pile, c'est ton carburant du lendemain.",
    next: "Fixe un rappel daté, et au moment de relancer repasse la fiche en « En appel » avant de composer.",
  },
  rdv: {
    goal: "La date est posée, et c'est maintenant que les devs construisent son site. Le jour J il découvre un site déjà fait pour lui : c'est cet effet-là qui fait basculer le oui.",
    next: "Vérifie que le site est prêt avant l'heure, puis démo et lien de paiement dans la foulée.",
  },
  lien_envoye: {
    goal: "Il a dit oui, mais tant qu'il n'a pas payé ça reste une promesse. Ton job : lever le dernier frein en montrant que le règlement prend deux minutes.",
    next: "Relance à 24h, puis à 48h si toujours rien.",
  },
  paye: {
    goal: "L'argent est encaissé, le prospect devient client. Ta vente est terminée : il ne reste qu'à mettre son site en ligne sur son vrai domaine.",
    next: "Préviens-le que son site part en production, et passe au suivant.",
  },
  pas_interesse: {
    goal: "Il a dit non — et un non propre vaut mieux qu'un dossier qui traîne. Ça libère ton temps pour les fiches qui peuvent signer.",
    next: "Note la raison du refus, puis laisse tomber : on ne le relance plus.",
  },
};

const CLOSER_STAGE_DESCRIPTIONS: Record<DeliveryStage, string> = {
  a_faire:
    "Ton RDV est posé : le site n'existe pas encore, un dev doit le sortir avant la date de ta démo.",
  en_cours: "Un dev construit le site en ce moment. C'est lui que tu montreras en démo.",
  termine:
    "Le site est prêt : tu peux faire ta démo. Une fois payé, il passe en ligne sur son vrai domaine.",
};

interface GuideRowProps {
  readonly badge: React.ReactNode;
  readonly description: string;
  /** Ligne d'action affichée sous la description (version closer). */
  readonly next?: string;
}

function GuideRow({ badge, description, next }: GuideRowProps) {
  return (
    <div className="flex items-start gap-3">
      <div className="w-28 flex-shrink-0 pt-0.5">{badge}</div>
      <div className="space-y-1">
        <p className="text-sm text-muted-foreground">{description}</p>
        {next && (
          <p className="flex items-start gap-1.5 text-sm font-medium text-foreground">
            <ArrowRight className="h-4 w-4 flex-shrink-0 translate-y-0.5 text-primary" />
            {next}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Lien « Guide des statuts » qui ouvre une modal expliquant chaque statut de
 * vente et chaque étape du pipeline dev.
 */
export function StatusGuideLink({ className }: { className?: string }) {
  const { data: session } = useSession();
  // Un closer lit ce guide entre deux appels : on lui parle de son objectif
  // commercial, pas du fonctionnement du CRM.
  const isCloser = session?.user?.role === "closer";

  return (
    <Dialog>
      <DialogTrigger
        className={cn(
          "inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer",
          className
        )}
        data-test="status-guide-link"
      >
        <HelpCircle className="h-4 w-4" />
        Guide des statuts
      </DialogTrigger>

      <DialogContent
        className="max-h-[85vh] overflow-y-auto sm:max-w-4xl"
        data-test="status-guide-modal"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HelpCircle className="h-5 w-5 text-primary" />
            Guide des statuts
          </DialogTitle>
          <DialogDescription>
            {isCloser
              ? "Chaque fiche avance étape par étape. À chaque statut, tu sais ce que tu cherches à obtenir et ce que tu fais juste après."
              : "Chaque prospect avance dans le cycle de vente, puis — une fois le rdv fixé — dans le pipeline dev de construction du site."}
          </DialogDescription>
        </DialogHeader>

        <div>
          <h3 className="text-sm font-semibold text-foreground mb-3">
            {isCloser ? "Ton cycle de vente" : "Cycle de vente"}
          </h3>
          <div className="space-y-3">
            {PROSPECT_STATUSES.map((status) => (
              <GuideRow
                key={status.value}
                badge={<Badge variant={status.color}>{status.label}</Badge>}
                description={
                  isCloser
                    ? CLOSER_STATUS_COPY[status.value].goal
                    : STATUS_DESCRIPTIONS[status.value]
                }
                next={
                  isCloser ? CLOSER_STATUS_COPY[status.value].next : undefined
                }
              />
            ))}
          </div>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-foreground mb-3">
            {isCloser
              ? "Ce qui se passe côté dev"
              : "Pipeline dev (livraison du site)"}
          </h3>
          <div className="space-y-3">
            {DELIVERY_STAGES.map((stage) => (
              <GuideRow
                key={stage.value}
                badge={
                  <Badge variant={STAGE_COLORS[stage.value]}>
                    {stage.label}
                  </Badge>
                }
                description={
                  isCloser
                    ? CLOSER_STAGE_DESCRIPTIONS[stage.value]
                    : STAGE_DESCRIPTIONS[stage.value]
                }
              />
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
