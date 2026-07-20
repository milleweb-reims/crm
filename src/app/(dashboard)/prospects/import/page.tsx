"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Upload, FileSpreadsheet, CheckCircle, AlertCircle } from "lucide-react";
import { Header } from "@/components/header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { detectMapping, parseRows } from "@/lib/import-parser";
import * as XLSX from "xlsx";

type Step = "upload" | "preview" | "importing" | "done";

interface ImportResult {
  readonly imported: number;
  readonly duplicates: number;
  readonly errors: number;
}

export default function ImportPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("upload");
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [parsedProspects, setParsedProspects] = useState<Record<string, unknown>[]>([]);
  const [closedCount, setClosedCount] = useState(0);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState("");

  const handleFile = useCallback((file: File) => {
    setError("");
    setFileName(file.name);

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: "array" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]!]!;
        const jsonData = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);

        if (jsonData.length === 0) {
          setError("Le fichier est vide");
          return;
        }

        const fileHeaders = Object.keys(jsonData[0]!);
        const detectedMapping = detectMapping(fileHeaders);

        setHeaders(fileHeaders);
        setRows(jsonData);
        setMapping(detectedMapping);

        const parsed = parseRows(jsonData, detectedMapping);
        setParsedProspects(parsed.prospects);
        setClosedCount(parsed.closedCount);
        setStep("preview");
      } catch {
        setError("Erreur lors de la lecture du fichier");
      }
    };
    reader.readAsArrayBuffer(file);
  }, []);

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }

  async function handleImport() {
    setStep("importing");

    const res = await fetch("/api/prospects/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prospects: parsedProspects }),
    });

    const data = await res.json();

    if (!res.ok) {
      setError(data.error || "Erreur lors de l'import");
      setStep("preview");
      return;
    }

    setResult(data);
    setStep("done");
  }

  return (
    <>
      <Header
        title="Import Excel"
        description="Importez vos prospects depuis un fichier Excel"
      />

      {step === "upload" && (
        <Card className="max-w-2xl mx-auto">
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
            className="border-2 border-dashed border-border rounded-lg p-12 text-center hover:border-primary/50 transition-colors"
          >
            <Upload className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-lg font-medium text-foreground mb-2">
              Glissez votre fichier ici
            </p>
            <p className="text-sm text-muted-foreground mb-4">
              ou cliquez pour sélectionner (.xlsx, .csv)
            </p>
            <label className="cursor-pointer inline-block">
              <span className="inline-flex items-center justify-center gap-2 rounded-lg text-sm font-semibold border border-border bg-background hover:bg-muted text-foreground h-10 px-4 py-2 transition-colors">
                Choisir un fichier
              </span>
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={handleInputChange}
                className="hidden"
              />
            </label>
          </div>
          {error && (
            <p className="text-sm text-red-600 mt-4 flex items-center gap-2">
              <AlertCircle className="h-4 w-4" />
              {error}
            </p>
          )}
        </Card>
      )}

      {step === "preview" && (
        <div className="space-y-6">
          <Card>
            <div className="flex items-center gap-3 mb-4">
              <FileSpreadsheet className="h-5 w-5 text-primary" />
              <div>
                <p className="font-medium">{fileName}</p>
                <p className="text-sm text-muted-foreground">
                  {rows.length} lignes détectées · {Object.keys(mapping).length}/{headers.length} colonnes mappées · {parsedProspects.length} prospects valides
                </p>
                {closedCount > 0 && (
                  <p className="text-sm text-orange-600">
                    {closedCount} établissement{closedCount > 1 ? "s" : ""} fermé{closedCount > 1 ? "s" : ""} définitivement exclu{closedCount > 1 ? "s" : ""}
                  </p>
                )}
              </div>
            </div>

            <div className="overflow-x-auto border border-border rounded-lg">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-muted/50">
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Nom</th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Téléphone</th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Ville</th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Email</th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Site</th>
                  </tr>
                </thead>
                <tbody>
                  {parsedProspects.slice(0, 5).map((p, i) => (
                    <tr key={i} className="border-t border-border">
                      <td className="px-3 py-2">{String(p.name || "—")}</td>
                      <td className="px-3 py-2">{String(p.phone || "—")}</td>
                      <td className="px-3 py-2">{String((p.address as Record<string, unknown>)?.city || "—")}</td>
                      <td className="px-3 py-2">{String(p.email || "—")}</td>
                      <td className="px-3 py-2 max-w-[200px] truncate">{String(p.websiteRoot || "—")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {parsedProspects.length > 5 && (
              <p className="text-xs text-muted-foreground mt-2">
                ...et {parsedProspects.length - 5} de plus
              </p>
            )}
          </Card>

          <div className="flex gap-3 justify-end">
            <Button variant="outline" onClick={() => { setStep("upload"); setRows([]); setClosedCount(0); setError(""); }}>
              Annuler
            </Button>
            <Button onClick={handleImport} disabled={parsedProspects.length === 0}>
              Importer {parsedProspects.length} prospects
            </Button>
          </div>

          {error && (
            <p className="text-sm text-red-600 flex items-center gap-2">
              <AlertCircle className="h-4 w-4" />
              {error}
            </p>
          )}
        </div>
      )}

      {step === "importing" && (
        <Card className="max-w-md mx-auto text-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto mb-4" />
          <p className="text-lg font-medium">Import en cours...</p>
          <p className="text-sm text-muted-foreground mt-1">
            {parsedProspects.length} prospects
          </p>
        </Card>
      )}

      {step === "done" && result && (
        <Card className="max-w-md mx-auto text-center py-12">
          <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-4" />
          <p className="text-lg font-medium mb-4">Import terminé</p>
          <div className="space-y-2 text-sm">
            <p className="text-green-600">{result.imported} prospects importés</p>
            {result.duplicates > 0 && (
              <p className="text-orange-600">{result.duplicates} doublons ignorés</p>
            )}
            {result.errors > 0 && (
              <p className="text-red-600">{result.errors} erreurs</p>
            )}
          </div>
          <Button className="mt-6" onClick={() => router.push("/prospects")}>
            Voir les prospects
          </Button>
        </Card>
      )}
    </>
  );
}
