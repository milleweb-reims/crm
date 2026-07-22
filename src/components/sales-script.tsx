"use client";

import { useState } from "react";
import { ArrowRight, Ban, Check, CornerDownRight, Lightbulb } from "lucide-react";
import { cn } from "@/lib/utils";

// Fiche closer — scripts de prospection Milleweb (source : doc interne
// « FICHE CLOSER », repris ici pour que le closer reste dans la fiche en appel).

interface ScriptStep {
  label: string;
  quotes: string[];
  coach?: string;
}

interface Objection {
  objection: string;
  response: string;
}

// Les étapes 2 à 4 sont communes aux deux scripts : seule l'accroche change.
const COMMON_STEPS: ScriptStep[] = [
  {
    label: "Pitch — Problème + solution instantanée",
    quotes: [
      "« Super, je prends 10 secondes, pas plus. En fait, je suis tombé sur votre profil sur internet et j'ai remarqué que vous n'aviez pas de site web. J'imagine qu'on vous appelle déjà très souvent pour ça. »",
      "« La grande différence aujourd'hui, c'est que j'ai pris la liberté de vous en créer un directement au lieu de vous promettre beaucoup de choses. »",
    ],
  },
  {
    label: "Appel à l'action — Basse friction",
    quotes: [
      "« Est-ce que vous seriez contre le fait de prendre 5 petites minutes dans la soirée / journée pour au moins jeter un petit coup d'œil et savoir s'il vous plaît ? Il n'y a pas de piège, pour l'instant c'est gratuit. Si le site vous plaît, on discutera de la suite, et si vous ne l'aimez pas, vous avez le droit de bloquer mon numéro. Est-ce que ça vous va ? »",
    ],
  },
  {
    label: "Verrouillage RDV",
    quotes: [
      "« Super. Vous êtes plus dispo le matin ou l'après-midi en général ? [...] Si je vous appelle demain à [Heure], ça vous va ? »",
    ],
    coach: "Forcer le choix matin / après-midi. Toujours proposer une heure précise.",
  },
];

const SCRIPTS: { id: string; tab: string; title: string; subtitle: string; steps: ScriptStep[] }[] = [
  {
    id: "script1",
    tab: "Script 1",
    title: "Honnêteté brutale",
    subtitle: "Le plus utilisé",
    steps: [
      {
        label: "Accroche — Pattern interrupt",
        quotes: [
          "« Bonjour. Si je vous dis que c'est un bon vieil appel de prospection, vous balancez votre téléphone par la fenêtre ou vous me laissez 10 petites secondes pour vous expliquer ? »",
        ],
        coach:
          "Attendre la réponse. Le prospect rit ou accepte. Ne pas enchaîner avant qu'il réponde.",
      },
      ...COMMON_STEPS,
    ],
  },
  {
    id: "script2",
    tab: "Script 2",
    title: "Provocateur / Contexte",
    subtitle: "Jouer sur l'ego",
    steps: [
      {
        label: "Accroche — Questionner l'absence",
        quotes: [
          "« Bonjour, je vous appelle parce que je me posais une sérieuse question au sujet de votre entreprise. Je me disais, par les temps qui courent (dans la France de 2026), comment une activité comme la vôtre arrive à se passer d'un site web ? »",
          "« Est-ce que c'est parce que vous avez déjà trop de clients, que vous êtes déjà trop riche, ou parce que vous n'avez pas eu le temps d'en créer un ? »",
        ],
        coach:
          "Laisser le silence agir. Ce script provoque une réaction — enchaîner vite sur le pitch.",
      },
      ...COMMON_STEPS,
    ],
  },
];

const OBJECTIONS: Objection[] = [
  {
    objection: "J'ai déjà assez de clients / pas besoin.",
    response:
      "« Le compte en banque est assez rempli ou on rajoute un zéro derrière ? Qu'est-ce qui ne vous intéresse pas dans le fait d'avoir plus de visibilité et plus de clients ? Même si les affaires marchent bien, un peu d'avance ça ne fait jamais de mal, vous ne pensez pas ? »",
  },
  {
    objection: "Je n'ai pas le temps, je travaille là.",
    response:
      "« J'imagine bien, c'est pour ça que je ne vous le montre pas maintenant. Mais si vous avez 5 minutes plus tard dans la journée ou demain, quand ça vous arrange, on prend 5 minutes et je vous le montre. 18h30 ça vous irait ? »",
  },
  {
    objection: "Ça va coûter cher / j'ai déjà un abonnement.",
    response:
      "« Pour l'instant, ça ne vous coûte absolument rien de regarder. Mais pour vous donner un ordre d'idée, si le site vous plaît, c'est un paiement unique autour de 500 euros, puis un abonnement de 29 euros par mois qui couvre l'hébergement, la maintenance et les mises à jour. Le site reste à vous. »",
  },
  {
    objection: "J'ai déjà quelqu'un qui m'appelle tous les jours pour ça.",
    response:
      "« Ça ne m'étonne pas. Mais monsieur, moi je vais faire mieux que tous ceux que vous avez reçus : j'ai déjà créé le site web pour vous. Ça vaut le coup d'y jeter un œil, non ? »",
  },
];

const GOLDEN_RULE = [
  "Pattern Interrupt",
  "Pitch 10 sec",
  "CTA Basse Friction",
  "Verrouillage RDV",
];

const TABS = [
  ...SCRIPTS.map((s) => ({ id: s.id, label: s.tab })),
  { id: "objections", label: "Objections" },
];

export function SalesScript() {
  const [tab, setTab] = useState("script1");
  const script = SCRIPTS.find((s) => s.id === tab);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Règle d'or : le déroulé de l'appel en un coup d'œil */}
      <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
        <Lightbulb className="h-4 w-4 shrink-0 text-amber-500" />
        <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-amber-700">
          Règle d&apos;or
        </span>
        {GOLDEN_RULE.map((step, i) => (
          <span key={step} className="inline-flex items-center gap-1.5">
            <span className="rounded-full border border-amber-300 bg-white px-2.5 py-0.5 text-xs font-medium text-amber-800">
              {step}
            </span>
            {i < GOLDEN_RULE.length - 1 && (
              <ArrowRight className="h-3 w-3 text-amber-400" />
            )}
          </span>
        ))}
      </div>

      {/* Onglets, dans le langage des filtres de statut */}
      <div className="mt-4 flex flex-wrap gap-1.5">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            aria-pressed={tab === t.id}
            data-test={`script-tab-${t.id}`}
            className={cn(
              "rounded-full border px-3 py-1.5 text-sm font-medium transition-colors cursor-pointer",
              tab === t.id
                ? "border-primary/30 bg-primary-light text-primary shadow-sm"
                : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-4 min-h-0 flex-1 overflow-y-auto pr-1">
        {script ? (
          <>
            <div className="mb-4 flex flex-wrap items-baseline gap-x-2">
              <h3 className="text-base font-semibold text-foreground">
                {script.title}
              </h3>
              <span className="text-sm text-muted-foreground">
                {script.subtitle}
              </span>
            </div>

            <ol className="space-y-5">
              {script.steps.map((step, i) => (
                <li key={step.label} className="flex gap-3">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1 space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {step.label}
                    </p>
                    {step.quotes.map((quote) => (
                      <p
                        key={quote}
                        className="rounded-lg border-l-2 border-primary bg-muted/50 px-3 py-2.5 text-sm leading-relaxed text-foreground"
                      >
                        {quote}
                      </p>
                    ))}
                    {step.coach && (
                      <p className="flex items-start gap-1.5 text-xs italic text-amber-700">
                        <CornerDownRight className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        {step.coach}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </>
        ) : (
          <div className="space-y-4">
            {OBJECTIONS.map((o) => (
              <div key={o.objection} className="space-y-2">
                <p className="flex items-start gap-2 text-sm font-medium text-red-700">
                  <Ban className="mt-0.5 h-4 w-4 shrink-0" />
                  {o.objection}
                </p>
                <p className="ml-6 flex items-start gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2.5 text-sm leading-relaxed text-green-900">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
                  {o.response}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="mt-3 border-t border-border pt-2 text-center text-xs text-muted-foreground">
        milléweb — usage interne closers, ne pas diffuser
      </p>
    </div>
  );
}
