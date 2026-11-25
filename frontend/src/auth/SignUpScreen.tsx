/**
 * SignUpScreen — account creation (Req 3.3, 3.4, 3.6-3.8, 3.12).
 */
import { useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { homeRouteFor } from "../identity/guard";
import { useCurrentIdentity } from "../identity/useCurrentIdentity";
import { Button, Field, Input } from "../shared/ui";
import { register, roleForAccountType, type AccountType } from "./authApi";
import { toAuthFailure, type AuthFailure } from "./authError";
import { AuthLayout } from "./AuthLayout";
import { PasswordField } from "./PasswordField";
import { validateEmail, validateFullName, validatePassword, type AuthField } from "./validate";

export function SignUpScreen() {
  const { signIn } = useCurrentIdentity();
  const navigate = useNavigate();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [accountType, setAccountType] = useState<AccountType>("RIDER");
  const [errors, setErrors] = useState<Partial<Record<AuthField, string>>>({});
  const [failure, setFailure] = useState<AuthFailure | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (submitting) return;
    const found = [validateFullName(fullName), validateEmail(email), validatePassword(password)];
    const next: Partial<Record<AuthField, string>> = {};
    for (const e of found) if (e) next[e.field] = e.message;
    setErrors(next);
    setFailure(null);
    if (Object.keys(next).length > 0) return;

    setSubmitting(true);
    try {
      const user = await register({
        fullName: fullName.trim(),
        email: email.trim(),
        password,
        accountType,
      });
      const identity = { role: roleForAccountType(user.accountType), id: user.id };
      signIn(identity);
      navigate(homeRouteFor(identity), { replace: true });
    } catch (error) {
      setFailure(toAuthFailure(error));
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout title="Create your account">
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <Field htmlFor="signup-name" label="Full name" error={errors.fullName}>
          <Input
            id="signup-name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            invalid={Boolean(errors.fullName)}
            autoComplete="name"
            disabled={submitting}
          />
        </Field>
        <Field htmlFor="signup-email" label="Email" error={errors.email}>
          <Input
            id="signup-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            invalid={Boolean(errors.email)}
            autoComplete="email"
            disabled={submitting}
          />
        </Field>
        <PasswordField
          id="signup-password"
          value={password}
          onChange={setPassword}
          error={errors.password}
          autoComplete="new-password"
          disabled={submitting}
        />
        <fieldset className="flex flex-col gap-2" disabled={submitting}>
          <legend className="mb-1.5 text-sm font-medium text-content">I want to</legend>
          <div className="grid grid-cols-2 gap-3">
            {(
              [
                ["RIDER", "Ride"],
                ["DRIVER", "Drive"],
              ] as const
            ).map(([value, label]) => (
              <label
                key={value}
                className="flex min-h-11 cursor-pointer items-center gap-2 rounded-xl bg-surface-raised px-4 py-3 text-sm font-semibold has-[:checked]:ring-2 has-[:checked]:ring-accent has-[:focus-visible]:ring-2"
              >
                <input
                  type="radio"
                  name="accountType"
                  value={value}
                  checked={accountType === value}
                  onChange={() => setAccountType(value)}
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
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
          Create account
        </Button>
      </form>
      <p className="text-center text-sm text-content-muted">
        Already have an account?{" "}
        <Link to="/sign-in" className="inline-flex min-h-11 items-center font-semibold text-accent underline">
          Sign in
        </Link>
      </p>
    </AuthLayout>
  );
}
