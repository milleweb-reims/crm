"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { Plus, Trash2, Shield, ShieldCheck, Code } from "lucide-react";
import { Header } from "@/components/header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { IUser, UserRole } from "@/types";

const roleConfig: Record<UserRole, { label: string; icon: React.ElementType; color: "violet" | "blue" | "orange" }> = {
  admin: { label: "Admin", icon: ShieldCheck, color: "violet" },
  closer: { label: "Closer", icon: Shield, color: "blue" },
  dev: { label: "Dev", icon: Code, color: "orange" },
};

export default function SettingsPage() {
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === "admin";

  const [users, setUsers] = useState<IUser[]>([]);
  const [loading, setLoading] = useState(true);

  // New user form
  const [showForm, setShowForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<UserRole>("closer");
  const [formError, setFormError] = useState("");

  // Delete confirmation
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [deleteName, setDeleteName] = useState("");

  // Password change
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [pwdMsg, setPwdMsg] = useState("");

  const fetchUsers = useCallback(async () => {
    const res = await fetch("/api/users");
    if (res.ok) setUsers(await res.json());
    setLoading(false);
  }, []);

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

  async function handleDeactivate(id: string, name: string) {
    setDeleteConfirm(id);
    setDeleteName(name);
  }

  async function confirmDeactivate() {
    if (!deleteConfirm) return;
    const res = await fetch(`/api/users/${deleteConfirm}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json();
      setFormError(data.error || "Erreur lors de la désactivation");
    }
    setDeleteConfirm(null);
    setDeleteName("");
    fetchUsers();
  }

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
                              {user._id !== session?.user?.id && user.isActive && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-destructive"
                                  onClick={() => handleDeactivate(user._id, user.name)}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Delete confirmation dialog */}
              {deleteConfirm && (
                <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-sm text-red-700 mb-3">
                    Désactiver le compte de <strong>{deleteName}</strong> ? Cette personne ne pourra plus se connecter.
                  </p>
                  <div className="flex gap-2">
                    <Button size="sm" variant="destructive" onClick={confirmDeactivate}>
                      Confirmer
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setDeleteConfirm(null)}>
                      Annuler
                    </Button>
                  </div>
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
    </>
  );
}
