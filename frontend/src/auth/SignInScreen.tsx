/**
 * SignInScreen — email-and-password login (Req 3.2, 3.5-3.8, 3.12).
 */
import { useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { homeRouteFor } from "../identity/guard";
import { useCurrentIdentity } from "../identity/useCurrentIdentity";
import { Button, Field, Input } from "../shared/ui";
import { login, roleForAccountType } from "./authApi";
import { toAuthFailure, type AuthFailure } from "./authError";
import { AuthLayout } from "./AuthLayout";
import { PasswordField } from "./PasswordField";
import { validateEmail, validatePassword, type AuthField } from "./validate";

export function SignInScreen() {
  const { signIn } = useCurrentIdentity();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Partial<Record<AuthField, string>>>({});
  const [failure, setFailure] = useState<AuthFailure | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (submitting) return;
    const found = [validateEmail(email), validatePassword(password)];
    const next: Partial<Record<AuthField, string>> = {};
    for (const e of found) if (e) next[e.field] = e.message;
    setErrors(next);
    setFailure(null);
    if (Object.keys(next).length > 0) return;

    setSubmitting(true);
    try {
      const user = await login({ email: email.trim(), password });
      const identity = { role: roleForAccountType(user.accountType), id: user.id };
      signIn(identity);
      navigate(homeRouteFor(identity), { replace: true });
    } catch (error) {
      setFailure(toAuthFailure(error));
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout title="Sign in to your account">
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <Field htmlFor="signin-email" label="Email" error={errors.email}>
          <Input
            id="signin-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            invalid={Boolean(errors.email)}
            autoComplete="email"
            disabled={submitting}
          />
        </Field>
        <PasswordField
          id="signin-password"
          value={password}
          onChange={setPassword}
          error={errors.password}
          autoComplete="current-password"
          disabled={submitting}
        />
        {failure ? (
          <div role="alert" className="flex flex-col gap-2 text-sm text-danger">
            <p>{failure.message}</p>
            {failure.unavailable ? (
              <Button variant="secondary" onClick={() => void submit()} disabled={submitting}>
                Retry
              </Button>
            ) : null}
          </div>
        ) : null}
        <Button type="submit" size="lg" block loading={submitting}>
          Sign in
        </Button>
      </form>
      <p className="text-center text-sm text-content-muted">
        New to RideNow?{" "}
        <Link to="/sign-up" className="inline-flex min-h-11 items-center font-semibold text-accent underline">
          Create an account
        </Link>
      </p>
    </AuthLayout>
  );
}
