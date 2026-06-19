"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Header } from "@/components/header";
import { Button } from "@/components/ui/button";
import { Card, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PROSPECT_STATUSES, type ProspectStatus } from "@/types";

export default function NewProspectPage() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError("");

    const formData = new FormData(e.currentTarget);

    const body = {
      name: formData.get("name"),
      phone: formData.get("phone"),
      email: formData.get("email"),
      websiteRoot: formData.get("websiteRoot"),
      status: formData.get("status"),
      address: {
        full: formData.get("addressFull"),
        city: formData.get("addressCity"),
        postalCode: formData.get("addressPostalCode"),
      },
    };

    const res = await fetch("/api/prospects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const data = await res.json();
      setError(data.error || "Erreur lors de la création");
      setSaving(false);
      return;
    }

    router.push("/prospects");
  }

  return (
    <>
      <div className="mb-6">
        <Button variant="ghost" size="sm" onClick={() => router.push("/prospects")}>
          <ArrowLeft className="h-4 w-4" />
          Retour
        </Button>
      </div>

      <Header title="Nouveau prospect" />

      <form onSubmit={handleSubmit} className="max-w-2xl space-y-6">
        <Card>
          <CardTitle>Informations générales</CardTitle>
          <CardContent className="mt-4 space-y-4">
            <div>
              <label htmlFor="name" className="block text-sm font-medium mb-1">
                Nom <span className="text-red-500">*</span>
              </label>
              <Input id="name" name="name" required placeholder="Nom de l'entreprise" />
            </div>

            <div>
              <label htmlFor="status" className="block text-sm font-medium mb-1">
                Statut
              </label>
              <select
                id="status"
                name="status"
                defaultValue="prospect"
                className="flex h-10 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
              >
                {PROSPECT_STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardTitle>Contact</CardTitle>
          <CardContent className="mt-4 space-y-4">
            <div>
              <label htmlFor="phone" className="block text-sm font-medium mb-1">
                Téléphone
              </label>
              <Input id="phone" name="phone" type="tel" placeholder="01 23 45 67 89" />
            </div>

            <div>
              <label htmlFor="email" className="block text-sm font-medium mb-1">
                Email
              </label>
              <Input id="email" name="email" type="email" placeholder="contact@entreprise.fr" />
            </div>

            <div>
              <label htmlFor="websiteRoot" className="block text-sm font-medium mb-1">
                Site web
              </label>
              <Input id="websiteRoot" name="websiteRoot" placeholder="www.entreprise.fr" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardTitle>Adresse</CardTitle>
          <CardContent className="mt-4 space-y-4">
            <div>
              <label htmlFor="addressFull" className="block text-sm font-medium mb-1">
                Adresse complète
              </label>
              <Input id="addressFull" name="addressFull" placeholder="12 rue de la Paix" />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="addressPostalCode" className="block text-sm font-medium mb-1">
                  Code postal
                </label>
                <Input id="addressPostalCode" name="addressPostalCode" placeholder="75000" />
              </div>
              <div>
                <label htmlFor="addressCity" className="block text-sm font-medium mb-1">
                  Ville
                </label>
                <Input id="addressCity" name="addressCity" placeholder="Paris" />
              </div>
            </div>
          </CardContent>
        </Card>

        {error && (
          <p className="text-sm text-red-600">{error}</p>
        )}

        <div className="flex gap-3 justify-end">
          <Button type="button" variant="outline" onClick={() => router.push("/prospects")}>
            Annuler
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? "Création..." : "Créer le prospect"}
          </Button>
        </div>
      </form>
    </>
  );
}
