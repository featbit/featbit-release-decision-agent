"use client";

import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/featbit-auth/auth-context";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LogOut, User2 } from "lucide-react";

function initials(name?: string | null, email?: string | null) {
  const source = (name || email || "?").trim();
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function UserMenu() {
  const { profile, organization, logout } = useAuth();
  const router = useRouter();

  if (!profile) return null;

  const handleLogout = async () => {
    await logout();
    router.replace("/login");
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            className="h-auto w-full justify-start gap-2 px-2 py-1.5"
          />
        }
      >
        <div className="flex size-7 items-center justify-center rounded-md bg-brand text-brand-foreground text-xs font-medium">
          {initials(profile.name, profile.email)}
        </div>
        <div className="flex min-w-0 flex-1 flex-col items-start text-left">
          <span className="truncate text-sm font-medium">
            {profile.name || profile.email}
          </span>
          <span className="truncate text-xs text-muted-foreground">
            {organization?.name || profile.email}
          </span>
        </div>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>
          <div className="flex flex-col">
            <span className="text-sm font-medium">{profile.name}</span>
            <span className="truncate text-xs text-muted-foreground">
              {profile.email}
            </span>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => router.push("/experiments")}>
          <User2 className="size-4" />
          <span>My experiments</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleLogout}>
          <LogOut className="size-4" />
          <span>Sign out</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
