/**
 * UserDetailScreen — look up a user by id and render the returned record (Req 8.3).
 *
 * The admin enters a user id and submits; the id drives a TanStack Query `useQuery`
 * (enabled only once an id is present) over the user Service_Client's `getUser`. While
 * pending a `Loading` indicator shows (Req 13.1). On a 404 the request layer yields
 * `ApiError.notFound`, rendered as a not-found message (Req 8.4); other sanitized
 * failures show through `ErrorBanner` (Req 13.2). On success the full record renders via
 * the shared `UserDetail` (Req 8.3).
 *
 * Confined to get only (Req 8.5). Restyled on the Tailwind kit; the form keeps
 * `aria-label="Look up user"` and the "User ID" field label.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { resolveUserClient } from "../../domain/user";
import type { UserResponse } from "../../domain/user";
import { appConfig } from "../../config/appConfig";
import { ApiError } from "../../http/ApiError";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  ErrorBanner,
  Field,
  Input,
  Loading,
} from "../../shared/ui";
import { UserDetail } from "./UserDetail";

export function UserDetailScreen() {
  const client = useMemo(() => resolveUserClient(appConfig), []);

  const [idInput, setIdInput] = useState("");
  const [lookupId, setLookupId] = useState<string | null>(null);

  const query = useQuery<UserResponse, Error>({
    queryKey: ["user", lookupId],
    queryFn: () => client.getUser(lookupId as string),
    enabled: lookupId !== null,
    retry: false,
  });

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = idInput.trim();
    if (trimmed === "") return;
    setLookupId(trimmed);
  }

  const isNotFound =
    query.isError && query.error instanceof ApiError && query.error.code === "NOT_FOUND";
  const errorMessage =
    query.isError && !isNotFound
      ? query.error instanceof ApiError
        ? query.error.message
        : "Something went wrong fetching the user."
      : null;

  return (
    <Card className="mx-auto max-w-2xl">
      <CardHeader>
        <CardTitle>Find user</CardTitle>
      </CardHeader>
      <CardBody>
        <form className="flex items-end gap-2" onSubmit={handleSubmit} aria-label="Look up user">
          <Field htmlFor="lookup-id" label="User ID" className="flex-1">
            <Input id="lookup-id" value={idInput} onChange={(e) => setIdInput(e.target.value)} />
          </Field>
          <Button type="submit">Look up</Button>
        </form>

        <div className="mt-4">
          {query.isPending && lookupId !== null && <Loading label="Loading user…" />}
          {isNotFound && (
            <p role="alert" className="text-sm text-danger">
              No user found for that id.
            </p>
          )}
          {errorMessage && <ErrorBanner message={errorMessage} />}
          {query.isSuccess && <UserDetail user={query.data} />}
        </div>
      </CardBody>
    </Card>
  );
}
