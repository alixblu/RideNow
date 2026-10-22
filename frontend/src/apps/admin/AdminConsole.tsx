/**
 * AdminConsole — the Admin_Console area (Req 8.1–8.5, 12.4).
 *
 * The admin area is DIRECTORY-first: the primary surface browses users from the live
 * list endpoint and opens one on selection to show its full record. Creating an account
 * is a secondary action, and looking a user up by id is an optional secondary path. The
 * console stays confined to the create/get/list surfaces the backend provides and never
 * exposes update or delete (Req 8.5, 12.4). No mock/live marker (Req 4.5).
 *
 * Every admin action stays wrapped in the admin identity guard for continuity with the
 * former placeholder (Req 2.4): until an admin Current_Identity is set, the "set your
 * identity" prompt shows instead of the screens.
 *
 * In-area navigation uses a stateful layout (the area is mounted at `admin/*` in
 * `routes.tsx`; this keeps it self-contained). The "Admin screens" nav switches between
 * the directory, the create form, and the lookup. Restyled on the Tailwind kit.
 */
import { useState } from "react";
import { IdentityPrompt, cn } from "../../shared/ui";
import { CreateUserScreen } from "./CreateUserScreen";
import { UserDetailScreen } from "./UserDetailScreen";
import { UserDirectory } from "./UserDirectory";

type AdminScreen = "directory" | "new" | "lookup";

const SCREENS: { key: AdminScreen; label: string }[] = [
  { key: "directory", label: "Directory" },
  { key: "new", label: "New account" },
  { key: "lookup", label: "Look up" },
];

export function AdminConsole() {
  const [screen, setScreen] = useState<AdminScreen>("directory");

  return (
    <section aria-label="Admin area" className="flex flex-col gap-6">
      <header>
        <h2 className="font-serif text-3xl font-semibold tracking-tight">Accounts</h2>
        <p className="mt-1 text-sm text-content-muted">
          Browse rider and user accounts, open one for the full record, and create new
          accounts when you need them.
        </p>
      </header>

      <IdentityPrompt role="admin">
        <nav
          aria-label="Admin screens"
          className="flex gap-6 overflow-x-auto border-b border-border"
        >
          {SCREENS.map((item) => (
            <button
              key={item.key}
              type="button"
              aria-current={screen === item.key ? "page" : undefined}
              onClick={() => setScreen(item.key)}
              className={cn(
                "-mb-px whitespace-nowrap border-b-2 pb-2.5 text-sm transition-colors",
                screen === item.key
                  ? "border-accent font-medium text-content"
                  : "border-transparent text-content-subtle hover:text-content",
              )}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div>
          {screen === "directory" ? (
            <UserDirectory />
          ) : screen === "new" ? (
            <CreateUserScreen />
          ) : (
            <UserDetailScreen />
          )}
        </div>
      </IdentityPrompt>
    </section>
  );
}
