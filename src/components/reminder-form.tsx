"use client";

import { useState } from "react";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface ReminderFormProps {
  prospectId: string;
  onCreated: () => void;
}

export function ReminderForm({ prospectId, onCreated }: ReminderFormProps) {
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !dueDate) return;

    setLoading(true);

    const res = await fetch("/api/reminders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prospectId,
        title: title.trim(),
        description: description.trim(),
        dueDate: new Date(dueDate),
      }),
    });

    if (!res.ok) {
      console.error("Failed to create reminder", { status: res.status });
      setLoading(false);
      return;
    }

    setTitle("");
    setDueDate("");
    setDescription("");
    setLoading(false);
    onCreated();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium text-foreground mb-2">
        <Bell className="h-4 w-4" />
        Nouveau rappel
      </div>
      <Input
        placeholder="Titre du rappel"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        required
      />
      <Input
        type="date"
        value={dueDate}
        onChange={(e) => setDueDate(e.target.value)}
        required
      />
      <textarea
        placeholder="Description (optionnel)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 resize-none min-h-[60px]"
      />
      <Button type="submit" size="sm" disabled={loading || !title.trim() || !dueDate}>
        {loading ? "Création..." : "Créer le rappel"}
      </Button>
    </form>
  );
}
