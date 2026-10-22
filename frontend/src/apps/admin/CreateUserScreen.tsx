/**
 * CreateUserScreen — the Admin_Console create-user form (Req 8.1, 8.2).
 *
 * Fields mirror `CreateUserRequest`: `cognitoSub`, `email`, and `fullName` are required;
 * `phone` and `avatarUrl` are optional. Client-side validation runs before any request:
 * it blocks submission and shows a field-level message for each blank required field,
 * and rejects an obviously malformed email (the backend enforces `@Email`). Only when
 * validation passes is the create request issued (Req 8.2).
 *
 * The request runs through the user Service_Client via TanStack Query `useMutation`. On
 * success the created user is rendered through the shared `UserDetail` (Req 8.1), a
 * success toast is shown, and the user directory query is invalidated so the new
 * account appears in the primary list. This is the SECONDARY admin action — the
 * primary surface is the directory. Confined to create only (Req 8.5). Restyled on the
 * Tailwind kit; the form keeps `aria-label="Create user"` and its field labels.
 */
import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2 } from "lucide-react";
import { resolveUserClient } from "../../domain/user";
import type { CreateUserRequest, UserResponse } from "../../domain/user";
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
  useToast,
} from "../../shared/ui";
import { UserDetail } from "./UserDetail";

/** A deliberately simple email check — mirrors the backend's basic `@Email` gate. */
function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

type FieldErrors = Partial<Record<"cognitoSub" | "email" | "fullName", string>>;

/** Validate the required fields and the email format. Empty result => valid. */
function validate(form: { cognitoSub: string; email: string; fullName: string }): FieldErrors {
  const errors: FieldErrors = {};
  if (form.cognitoSub.trim() === "") errors.cognitoSub = "Cognito sub is required.";
  if (form.email.trim() === "") errors.email = "Email is required.";
  else if (!isValidEmail(form.email.trim())) errors.email = "Enter a valid email address.";
  if (form.fullName.trim() === "") errors.fullName = "Full name is required.";
  return errors;
}

export function CreateUserScreen() {
  const client = useMemo(() => resolveUserClient(appConfig), []);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [cognitoSub, setCognitoSub] = useState("");
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});

  const mutation = useMutation<UserResponse, Error, CreateUserRequest>({
    mutationFn: (req) => client.createUser(req),
    onSuccess: () => {
      toast("User created.", "success");
      // Refetch the directory so the new account shows up in the primary list.
      void queryClient.invalidateQueries({ queryKey: ["users"] });
    },
  });

  const errorMessage =
    mutation.error instanceof ApiError
      ? mutation.error.message
      : mutation.error
        ? "Something went wrong creating the user."
        : null;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validate({ cognitoSub, email, fullName });
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return; // Block submission — no backend request is issued (Req 8.2).
    }
    const req: CreateUserRequest = {
      cognitoSub: cognitoSub.trim(),
      email: email.trim(),
      fullName: fullName.trim(),
    };
    const trimmedPhone = phone.trim();
    const trimmedAvatar = avatarUrl.trim();
    if (trimmedPhone !== "") req.phone = trimmedPhone;
    if (trimmedAvatar !== "") req.avatarUrl = trimmedAvatar;
    mutation.mutate(req);
  }

  if (mutation.isSuccess) {
    return (
      <Card className="mx-auto max-w-2xl">
        <CardBody className="pt-5">
          <p role="status" className="mb-4 flex items-center gap-2 text-sm font-medium text-success">
            <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
            User created.
          </p>
          <UserDetail user={mutation.data} />
        </CardBody>
      </Card>
    );
  }

  return (
    <Card className="mx-auto max-w-2xl">
      <CardHeader>
        <CardTitle>Create user</CardTitle>
      </CardHeader>
      <CardBody>
        <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate aria-label="Create user">
          <Field htmlFor="cognitoSub" label="Cognito sub" required error={errors.cognitoSub}>
            <Input
              id="cognitoSub"
              value={cognitoSub}
              onChange={(e) => setCognitoSub(e.target.value)}
              invalid={Boolean(errors.cognitoSub)}
            />
          </Field>

          <Field htmlFor="email" label="Email" required error={errors.email}>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              invalid={Boolean(errors.email)}
            />
          </Field>

          <Field htmlFor="fullName" label="Full name" required error={errors.fullName}>
            <Input
              id="fullName"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              invalid={Boolean(errors.fullName)}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field htmlFor="phone" label="Phone">
              <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </Field>
            <Field htmlFor="avatarUrl" label="Avatar URL">
              <Input id="avatarUrl" value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value)} />
            </Field>
          </div>

          {errorMessage && <ErrorBanner message={errorMessage} />}
          {mutation.isPending && <Loading label="Creating user…" />}

          <Button type="submit" size="lg" loading={mutation.isPending}>
            {mutation.isPending ? "Creating…" : "Create user"}
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}
