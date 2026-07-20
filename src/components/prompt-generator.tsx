"use client";

import { useState } from "react";
import { Wand2, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardTitle, CardContent } from "@/components/ui/card";
import { DAY_LABELS_FR, formatHoursFr } from "@/lib/format";
import type { IProspect } from "@/types";

interface PromptGeneratorProps {
  prospect: IProspect;
  className?: string;
  // Modale dev : le prompt est déjà ce qu'on est venu voir, pas besoin du
  // bouton "Générer le prompt" ni du titre de carte (déjà dans l'en-tête modale).
  alwaysOpen?: boolean;
}

function buildPrompt(prospect: IProspect): string {
  const name = prospect.name || "[NOM DE L'ÉTABLISSEMENT]";
  const category = prospect.tags?.length ? prospect.tags.join(", ") : "";
  const categoryParens = category ? ` (${category})` : "";
  const address = prospect.address?.full || "[ADRESSE]";
  const city = prospect.address?.city || "[VILLE]";
  const phone = prospect.phone || "[TÉLÉPHONE]";
  const mapsLink = prospect.googleMapsLink || "[LIEN GOOGLE MAPS]";

  const hoursEntries = Object.entries(prospect.openingHours || {});
  const hoursLines = hoursEntries.length
    ? hoursEntries
        .map(
          ([day, hours]) =>
            `${DAY_LABELS_FR[day] ?? day} : ${formatHoursFr(String(hours))}`
        )
        .join("\n")
    : "[à compléter avec les horaires]";

  return `CONTEXTE
Tu es directeur artistique senior. Crée un site vitrine ONE PAGE pour ${name}${categoryParens}, situé ${address}. Cible : clientèle locale et prospects qui cherchent ce type d'établissement/service à proximité. Objectif unique de la page : donner envie de contacter ou de se rendre sur place. Actions prioritaires : appeler et ouvrir l'itinéraire Google Maps.

IMPORTANT : ignore tout design system préconfiguré dans ce workspace.

LAYOUT DE RÉFÉRENCE (obligatoire)
Le site reproduit la structure du site les-soins-by-louison.fr (un institut de beauté), adaptée en une seule page à ancres. La description ci-dessous fait foi : l'ordre des sections et la composition de chacune sont NON NÉGOCIABLES. ATTENTION : la palette rose/mauve de la référence est propre au monde de la beauté — ne la copie pas. Ce qui s'adapte à l'identité de ${name} : la palette d'accents, les pictogrammes, les photos et les textes.

FICHIERS FOURNIS AVEC CE PROMPT
- Le logo (s'il est fourni) : utilise-le tel quel, sans le redessiner, le recolorer ni le déformer.
- Des photos réelles du lieu/des réalisations, si disponibles : utilise uniquement ces photos, en grand format. Interdiction absolue de générer des images ou d'utiliser des visuels génériques de banque d'images. Si une section manque de photo, traite-la en typographie et aplats de couleur, jamais en image inventée.

GRAMMAIRE VISUELLE (commune à toutes les sections)
- Fond général crème/ivoire (jamais blanc pur). Titres dans une couleur encre très foncée (bleu nuit, brun profond ou vert sapin selon le métier). Corps de texte gris moyen.
- 1 couleur d'accent + 1 couleur pastel secondaire cohérentes avec l'activité de ${name} (ex. chauffagiste : bleu nuit + terracotta flamme ; boulangerie : brun + blé ; fleuriste : vert sapin + rose poudré). Interdits : dégradés violets/bleus SaaS, glassmorphism, emojis, icônes 3D, illustrations génériques corporate.
- Titres : Literata, poids 300 (à défaut un serif éditorial équivalent : Fraunces, Cormorant), très grandes tailles (~110 px pour le titre du hero, ~55 px pour les titres de section sur desktop, réduits proportionnellement sur mobile). Corps : sans-serif humaniste sobre (style Mulish ou Jost). Interdits : Inter, Poppins.
- Chaque section s'ouvre sur un surtitre : petit pictogramme en trait fin + libellé court, posé au-dessus du titre serif.
- Boutons pilule (coins entièrement arrondis) ; les boutons de découverte (« En savoir plus »…) portent une flèche →, pas « Appeler » ni « Itinéraire ».
- Toutes les photos sont dans des cartes à coins arrondis (~28 px). Le site alterne sections en 2 colonnes et sections centrées, exactement comme décrit ci-dessous.
- Pictogrammes en trait fin uniquement. Décors discrets liés au métier, débordant des coins de certaines sections (ex. feuillages détourés pour le bien-être, flammes/outils en trait fin pour un chauffagiste).

STRUCTURE ONE PAGE, DANS CET ORDRE EXACT
1. Header sticky fond crème : logo à gauche, navigation par ancres centrée (Accueil, À propos, Services, Avis, Contact). Sur mobile, bouton « Appeler » toujours visible.
2. Hero « carte » : PAS de hero bord à bord. Une grande carte photo à coins très arrondis, avec une marge visible tout autour, occupant ~85 % de la hauteur d'écran. Photo réelle couvrant toute la carte + voile sombre en dégradé (~35 % d'opacité) qui garantit la lisibilité du texte clair. Contenu aligné à gauche : surtitre « Bienvenue chez », titre serif géant « ${name}. » (terminé par un point), puis deux boutons pilule : « Appeler » (tel:${phone}) et « Itinéraire » (${mapsLink}).
3. À propos, 2 colonnes : à gauche, surtitre « À propos », titre serif, 3 phrases maximum sur ${name}${categoryParens} à ${city}, liste de 4 à 6 atouts concrets avec coches réparties sur 2 colonnes, bouton pilule ; à droite, une photo arrondie avec, chevauchant son coin bas-gauche, une petite carte carrée arrondie à fond sombre (couleur encre) et texte blanc portant le chiffre clé (${
    prospect.reviews?.rating
      ? `« ${prospect.reviews.rating}/5 · ${prospect.reviews.count} avis Google »`
      : "note Google ou nombre de clients [à compléter]"
  }).
4. Prestations phares : 2 grandes cartes côte à côte (carrousel) ; chaque carte : photo à gauche, pictogramme trait fin en haut à droite, étiquette (« À partir de X € », « Offert » ou [à compléter]), titre serif, 1 ligne de description. Deux boutons ronds ‹ › discrets sous les cartes.
5. Services : bande pleine largeur, fond légèrement plus soutenu que le crème et teinté selon la palette du métier (sable, lin, pierre…), bords supérieur ET inférieur en déchirure de papier irrégulière (découpe ondulée marquée). Surtitre et titre serif centrés, puis les 4 prestations réelles du métier de ${name} en grille : grand cercle blanc contenant un pictogramme trait fin, titre, 2 lignes de description. Bouton pilule centré dessous.
6. Marquee : bande horizontale de très grands mots en lettres creuses (contour fin gris très clair, presque fondu dans le fond crème) qui défilent lentement — les prestations clés de ${name} — séparés par un pictogramme.
7. L'établissement, 2 colonnes : à gauche, surtitre « Qui sommes-nous », titre serif, court paragraphe, puis 2 lignes avec pictogramme (« Depuis [année à compléter] », « clients satisfaits [à compléter] ») ; à droite, deux photos arrondies légèrement décalées l'une par rapport à l'autre.
8. Témoignages : surtitre et titre serif alignés à gauche « Ce que disent nos clients », puis 3 cartes d'avis : avatar rond, nom, note et ancienneté (« 5/5 · il y a X mois »), citation, 5 étoiles. ${
    prospect.reviews?.rating
      ? `Rappelle la note Google réelle : ${prospect.reviews.rating}/5 (${prospect.reviews.count} avis). `
      : ""
  }N'invente aucun avis : reprends les avis Google fournis, sinon écris [à compléter].
9. Bande rendez-vous : grande carte pleine largeur à coins arrondis, fond dans la couleur pastel secondaire de la palette : surtitre + très gros titre serif d'appel à l'action à gauche, gros bouton pilule sombre « Appeler maintenant » (tel:${phone}) à droite.
10. Footer fond sombre (couleur encre), motif décoratif en trait fin lié au métier en arrière-plan : 3 colonnes — Liens (les ancres de la page), Contact (adresse, téléphone cliquable, email), Horaires (une ligne par jour, jour et valeur reliés par des points de conduite) ; en bas : logo, réseaux sociaux, mentions légales, copyright.
   Horaires :
${hoursLines}
   Adresse : ${address}
   Téléphone : ${phone}

RÉDACTION (critère numéro 1 du rendu non-IA)
- Français naturel, ton direct, phrases courtes, adapté à l'activité de ${name}.
- Interdits : « niché au cœur de », « une expérience unique », « des moments inoubliables », « que vous soyez X ou Y », tout superlatif vide.
- Chaque phrase doit porter une information concrète : lieu, horaire, prestation, tarif. Si l'information manque, écris [à compléter] au lieu d'inventer.

TECHNIQUE
- Mobile first : l'essentiel du trafic viendra de la fiche Google sur téléphone. Bouton d'appel accessible en permanence sur mobile.
- Une seule page, navigation par ancres, chargement rapide. Seules animations tolérées : le défilement du marquee et des transitions douces.`;
}

export function PromptGenerator({ prospect, className, alwaysOpen = false }: PromptGeneratorProps) {
  const [showPrompt, setShowPrompt] = useState(false);
  const [copied, setCopied] = useState(false);

  const prompt = buildPrompt(prospect);

  async function handleCopy() {
    await navigator.clipboard.writeText(prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const promptBlock = (
    <div className="relative">
      <Button
        variant="outline"
        size="sm"
        onClick={handleCopy}
        className="absolute top-2 right-2 z-10"
      >
        {copied ? (
          <>
            <Check className="h-3.5 w-3.5 text-green-500" />
            Copié
          </>
        ) : (
          <>
            <Copy className="h-3.5 w-3.5" />
            Copier
          </>
        )}
      </Button>
      <pre className="bg-muted/50 rounded-lg p-4 pr-24 text-sm whitespace-pre-wrap overflow-auto max-h-[500px] border border-border">
        {prompt}
      </pre>
    </div>
  );

  if (alwaysOpen) {
    return <div className={className}>{promptBlock}</div>;
  }

  return (
    <Card className={className}>
      <div className="flex items-center justify-between">
        <CardTitle>Prompt Claude Design</CardTitle>
        <Button
          variant={showPrompt ? "outline" : "default"}
          size="sm"
          onClick={() => setShowPrompt(!showPrompt)}
        >
          <Wand2 className="h-4 w-4" />
          {showPrompt ? "Masquer" : "Générer le prompt"}
        </Button>
      </div>

      {showPrompt && <CardContent className="mt-4">{promptBlock}</CardContent>}
    </Card>
  );
}
