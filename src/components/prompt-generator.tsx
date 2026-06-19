"use client";

import { useState } from "react";
import { Wand2, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardTitle, CardContent } from "@/components/ui/card";
import type { IProspect } from "@/types";

interface PromptGeneratorProps {
  prospect: IProspect;
}

function buildPrompt(p: IProspect): string {
  const lines: string[] = [];

  lines.push(`Crée un site web vitrine moderne et professionnel pour l'entreprise suivante :\n`);

  // Company info
  lines.push(`## Informations entreprise`);
  lines.push(`- **Nom** : ${p.name}`);
  if (p.address?.city) lines.push(`- **Ville** : ${p.address.city}${p.address.postalCode ? ` (${p.address.postalCode})` : ""}`);
  if (p.address?.region) lines.push(`- **Région** : ${p.address.region}`);
  if (p.address?.full) lines.push(`- **Adresse complète** : ${p.address.full}`);
  if (p.phone) lines.push(`- **Téléphone** : ${p.phone}`);
  if (p.email) lines.push(`- **Email** : ${p.email}`);

  // Detect business type from name
  const nameLower = p.name.toLowerCase();
  const keywords: string[] = [];
  const businessTypes: Record<string, string[]> = {
    "rénovation": ["rénovation", "travaux", "bâtiment"],
    "plomberie": ["plombier", "plomberie"],
    "électricité": ["électricien", "électricité", "electri"],
    "couverture": ["couverture", "couvreur", "toiture"],
    "chauffage": ["chauffage", "chauffagiste"],
    "peinture": ["peinture", "peintre"],
    "maçonnerie": ["maçon", "maçonnerie"],
    "menuiserie": ["menuisier", "menuiserie"],
    "carrelage": ["carreleur", "carrelage"],
    "serrurerie": ["serrurier", "serrurerie"],
    "dépannage": ["dépannage"],
    "nettoyage": ["nettoyage", "propreté"],
    "paysagiste": ["paysagiste", "jardin", "espaces verts"],
    "immobilier": ["immobilier", "agence immobilière"],
    "restaurant": ["restaurant", "brasserie", "traiteur"],
    "boulangerie": ["boulangerie", "pâtisserie"],
    "coiffure": ["coiffeur", "coiffure", "salon"],
    "automobile": ["garage", "auto", "mécanique"],
  };

  for (const [type, terms] of Object.entries(businessTypes)) {
    if (terms.some((t) => nameLower.includes(t))) {
      keywords.push(type);
    }
  }

  if (keywords.length > 0) {
    lines.push(`- **Secteur d'activité** : ${keywords.join(", ")}`);
  }

  // Website & social
  if (p.websiteRoot) lines.push(`- **Site actuel** : ${p.websiteRoot}`);
  if (p.socialLinks?.facebook) lines.push(`- **Facebook** : ${p.socialLinks.facebook}`);

  // Reviews
  if (p.reviews?.rating > 0) {
    lines.push(`- **Note Google** : ${p.reviews.rating}/5 (${p.reviews.count} avis)`);
  }

  // Opening hours
  if (p.openingHours && Object.keys(p.openingHours).length > 0) {
    lines.push(`\n## Horaires d'ouverture`);
    const dayLabels: Record<string, string> = {
      monday: "Lundi", tuesday: "Mardi", wednesday: "Mercredi",
      thursday: "Jeudi", friday: "Vendredi", saturday: "Samedi", sunday: "Dimanche",
    };
    for (const [day, hours] of Object.entries(p.openingHours)) {
      const label = dayLabels[day] || day;
      lines.push(`- ${label} : ${String(hours) === "closed" ? "Fermé" : String(hours)}`);
    }
  }

  // Design instructions
  lines.push(`\n## Instructions de design`);
  lines.push(`- Design moderne, épuré et professionnel`);
  lines.push(`- Responsive (mobile-first)`);
  lines.push(`- Palette de couleurs adaptée au secteur${keywords.length > 0 ? ` (${keywords[0]})` : ""}`);
  lines.push(`- Police lisible et professionnelle`);

  // Pages
  lines.push(`\n## Pages à créer`);
  lines.push(`1. **Accueil** : Hero section avec slogan accrocheur, présentation rapide des services, témoignages clients, appel à l'action (CTA) pour demander un devis`);
  lines.push(`2. **Services** : Liste détaillée des prestations avec descriptions`);
  lines.push(`3. **À propos** : Histoire de l'entreprise, valeurs, équipe`);
  if (p.reviews?.rating > 0) {
    lines.push(`4. **Avis clients** : Section avec les avis Google (note ${p.reviews.rating}/5)`);
  }
  lines.push(`${p.reviews?.rating > 0 ? "5" : "4"}. **Contact** : Formulaire de contact, coordonnées (téléphone, email, adresse), carte Google Maps, horaires d'ouverture`);

  // Images
  lines.push(`\n## Images`);
  lines.push(`- Utilise des images professionnelles et réalistes (pas de stock générique)`);
  lines.push(`- Hero : grande image de fond en rapport avec l'activité${keywords.length > 0 ? ` (${keywords[0]})` : ""}`);
  lines.push(`- Services : une image ou icône illustrative par prestation`);
  lines.push(`- À propos : photo d'équipe ou de chantier/réalisation`);
  lines.push(`- Galerie de réalisations / photos avant-après si pertinent`);
  lines.push(`- Toutes les images doivent avoir des attributs alt descriptifs pour le SEO`);
  lines.push(`- Formats optimisés (WebP) avec lazy loading`);

  // SEO
  lines.push(`\n## SEO`);
  lines.push(`- Optimisé pour le référencement local (${p.address?.city || "ville"})`);
  lines.push(`- Meta title et description sur chaque page`);
  lines.push(`- Balises schema.org LocalBusiness`);

  // Tech
  lines.push(`\n## Stack technique`);
  lines.push(`- HTML/CSS/JS statique ou Next.js`);
  lines.push(`- Formulaire de contact fonctionnel`);
  lines.push(`- Performance optimale (Core Web Vitals)`);

  return lines.join("\n");
}

export function PromptGenerator({ prospect }: PromptGeneratorProps) {
  const [showPrompt, setShowPrompt] = useState(false);
  const [copied, setCopied] = useState(false);

  const prompt = buildPrompt(prospect);

  async function handleCopy() {
    await navigator.clipboard.writeText(prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Card>
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

      {showPrompt && (
        <CardContent className="mt-4">
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
        </CardContent>
      )}
    </Card>
  );
}
