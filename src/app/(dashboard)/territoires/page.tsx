"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { MapPin, Plus, Trash2 } from "lucide-react";

import { Header } from "@/components/header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface Closer {
  readonly _id: string;
  readonly name: string;
  readonly email: string;
}

interface Territory {
  readonly _id: string;
  readonly city: string;
  readonly cityKey: string;
  readonly closers: ReadonlyArray<Closer>;
  readonly prospectCount: number;
  readonly unassignedCount: number;
}

interface City {
  readonly cityKey: string;
  readonly city: string;
  readonly prospectCount: number;
  readonly unassignedCount: number;
  readonly hasTerritory: boolean;
}

interface EditorState {
  readonly open: boolean;
  readonly territoryId: string | null;
  readonly city: string;
  readonly closerIds: ReadonlyArray<string>;
}

const CLOSED_EDITOR: EditorState = {
  open: false,
  territoryId: null,
  city: "",
  closerIds: [],
};

export default function TerritoiresPage() {
  const { data: session } = useSession();
  const [territories, setTerritories] = useState<Territory[]>([]);
  const [closers, setClosers] = useState<Closer[]>([]);
  const [cities, setCities] = useState<City[]>([]);
  const [editor, setEditor] = useState<EditorState>(CLOSED_EDITOR);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [citySearch, setCitySearch] = useState("");

  const load = useCallback(async () => {
    const [territoriesRes, usersRes, citiesRes] = await Promise.all([
      fetch("/api/territories"),
      fetch("/api/users"),
      fetch("/api/cities"),
    ]);

    if (!territoriesRes.ok) {
      setError("Impossible de charger les territoires");
      return;
    }

    const territoriesData = await territoriesRes.json();
    setTerritories(territoriesData.territories ?? []);

    if (usersRes.ok) {
      // GET /api/users retourne un tableau nu (src/app/api/users/route.ts:15),
      // pas un objet enveloppe.
      const users: ReadonlyArray<Closer & { role: string; isActive: boolean }> =
        await usersRes.json();

      setClosers(
        users.filter((user) => user.role === "closer" && user.isActive)
      );
    }

    if (citiesRes.ok) {
      const citiesData = await citiesRes.json();
      setCities(citiesData.cities ?? []);
    }
  }, []);

  /* eslint-disable react-hooks/set-state-in-effect -- Chargement initial des données */
  useEffect(() => {
    load();
  }, [load]);
  /* eslint-enable react-hooks/set-state-in-effect */

  function toggleCloser(closerId: string) {
    setEditor((current) => ({
      ...current,
      closerIds: current.closerIds.includes(closerId)
        ? current.closerIds.filter((id) => id !== closerId)
        : [...current.closerIds, closerId],
    }));
  }

  async function handleSubmit() {
    setError("");

    const isEdit = editor.territoryId !== null;
    const res = await fetch(
      isEdit ? `/api/territories/${editor.territoryId}` : "/api/territories",
      {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ city: editor.city, closers: editor.closerIds }),
      }
    );

    const data = await res.json();

    if (!res.ok) {
      setError(data.error || "Erreur lors de l'enregistrement");
      return;
    }

    setNotice(
      data.assigned > 0
        ? `${data.assigned} prospect${data.assigned > 1 ? "s" : ""} attribué${data.assigned > 1 ? "s" : ""}`
        : "Territoire enregistré, aucun prospect à attribuer"
    );
    setEditor(CLOSED_EDITOR);
    setCitySearch("");
    await load();
  }

  async function handleDelete(territory: Territory) {
    const confirmed = window.confirm(
      `Supprimer le territoire ${territory.city} ? Les attributions déjà faites sont conservées.`
    );
    if (!confirmed) return;

    const res = await fetch(`/api/territories/${territory._id}`, {
      method: "DELETE",
    });

    if (!res.ok) {
      setError("Suppression impossible");
      return;
    }

    await load();
  }

  if (session?.user?.role !== "admin") {
    return (
      <>
        <Header title="Territoires" description="Réservé aux administrateurs" />
        <Card className="max-w-md mx-auto text-center py-12">
          <p className="text-muted-foreground">Accès refusé</p>
        </Card>
      </>
    );
  }

  // Les villes déjà couvertes sont retirées : le serveur refuserait la création
  // avec un conflit, autant ne pas les proposer. Le filtre porte sur la graphie
  // affichée, insensible à la casse.
  const availableCities = cities.filter(
    (city) =>
      !city.hasTerritory &&
      city.city.toLowerCase().includes(citySearch.trim().toLowerCase())
  );

  return (
    <>
      <Header
        title="Territoires"
        description="Attribuez les villes à vos closers"
      />

      <div className="flex justify-end mb-4">
        <Button
          onClick={() => setEditor({ ...CLOSED_EDITOR, open: true })}
          data-test="territory-create"
        >
          <Plus className="h-4 w-4" />
          Nouveau territoire
        </Button>
      </div>

      {notice && <p className="text-sm text-green-600 mb-4">{notice}</p>}
      {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

      <Card>
        {territories.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            Aucun territoire. Créez-en un pour répartir automatiquement les
            prospects d&apos;une ville.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50">
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Ville</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Closers</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Prospects</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Non attribués</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {territories.map((territory) => (
                  <tr key={territory._id} className="border-t border-border">
                    <td className="px-3 py-2 font-medium">
                      <span className="inline-flex items-center gap-2">
                        <MapPin className="h-4 w-4 text-muted-foreground" />
                        {territory.city}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {territory.closers.length === 0
                        ? "—"
                        : territory.closers.map((closer) => closer.name).join(", ")}
                    </td>
                    <td className="px-3 py-2">{territory.prospectCount}</td>
                    <td className="px-3 py-2">
                      {territory.unassignedCount > 0 ? (
                        <span className="text-orange-600">{territory.unassignedCount}</span>
                      ) : (
                        "0"
                      )}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setEditor({
                            open: true,
                            territoryId: territory._id,
                            city: territory.city,
                            closerIds: territory.closers.map((closer) => closer._id),
                          })
                        }
                        data-test="territory-edit"
                      >
                        Modifier
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDelete(territory)}
                        title="Supprimer"
                        data-test="territory-delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Dialog
        open={editor.open}
        onOpenChange={(open) => {
          if (!open) {
            setEditor(CLOSED_EDITOR);
            setCitySearch("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editor.territoryId ? "Modifier le territoire" : "Nouveau territoire"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-1 block">Ville</label>

              {editor.territoryId !== null ? (
                <p className="text-sm text-muted-foreground">{editor.city}</p>
              ) : (
                <>
                  <Input
                    value={citySearch}
                    onChange={(e) => setCitySearch(e.target.value)}
                    placeholder="Filtrer les villes..."
                    data-test="territory-city-search"
                  />

                  <div className="mt-2 max-h-56 overflow-y-auto border border-border rounded-lg divide-y divide-border">
                    {availableCities.length === 0 ? (
                      <p className="text-sm text-muted-foreground px-3 py-4 text-center">
                        Aucune ville disponible. Importez des prospects, ou
                        toutes les villes ont déjà un territoire.
                      </p>
                    ) : (
                      availableCities.map((city) => (
                        <button
                          key={city.cityKey}
                          type="button"
                          onClick={() =>
                            setEditor((current) => ({
                              ...current,
                              city: city.city,
                            }))
                          }
                          className={cn(
                            "w-full text-left px-3 py-2 text-sm transition-colors cursor-pointer",
                            editor.city === city.city
                              ? "bg-primary/10 text-primary font-medium"
                              : "hover:bg-muted"
                          )}
                          data-test="territory-city-option"
                        >
                          <span className="flex items-center justify-between gap-3">
                            <span>{city.city}</span>
                            <span className="text-xs text-muted-foreground whitespace-nowrap">
                              {city.prospectCount} prospect
                              {city.prospectCount > 1 ? "s" : ""}
                              {city.unassignedCount > 0 &&
                                ` · ${city.unassignedCount} à attribuer`}
                            </span>
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                </>
              )}
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block">Closers</label>
              {closers.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Aucun closer actif.
                </p>
              ) : (
                <div className="space-y-2">
                  {closers.map((closer) => (
                    <label
                      key={closer._id}
                      className="flex items-center gap-2 cursor-pointer"
                    >
                      <Checkbox
                        checked={editor.closerIds.includes(closer._id)}
                        onCheckedChange={() => toggleCloser(closer._id)}
                      />
                      <span className="text-sm">{closer.name}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            <p className="text-xs text-muted-foreground">
              Les prospects déjà attribués ne sont jamais redistribués. Seuls
              les prospects sans closer sont répartis.
            </p>

            <div className="flex gap-3 justify-end">
              <Button
                variant="outline"
                onClick={() => {
                  setEditor(CLOSED_EDITOR);
                  setCitySearch("");
                }}
              >
                Annuler
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={editor.city.trim() === ""}
                data-test="territory-submit"
              >
                Enregistrer
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
