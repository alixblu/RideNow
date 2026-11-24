/**
 * SignInScreen — brand mark, phone input, Continue. A valid phone navigates to
 * `/role` with `state: { phone }`; an invalid one shows an inline aria-live message
 * and stays on the page (Req 2.2, 2.3, 2.4).
 */
import { useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Field, Input } from "../shared/ui";
import { validatePhone } from "./phone";

export function SignInScreen() {
  const navigate = useNavigate();
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const result = validatePhone(phone);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setError("");
    navigate("/role", { state: { phone: result.digits } });
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col justify-center gap-8 px-6 py-10">
      <div className="flex flex-col items-center gap-3 text-center">
        <span
          aria-hidden="true"
          className="flex h-16 w-16 items-center justify-center rounded-2xl bg-accent text-3xl font-extrabold text-accent-fg"
        >
          R
        </span>
        <h1 className="text-3xl font-extrabold text-content">RideNow</h1>
        <p className="text-content-muted">Sign in with your phone number to get moving.</p>
      </div>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4" data-touch>
        <Field htmlFor="phone" label="Phone number">
          <Input
            id="phone"
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="0901 234 567"
            value={phone}
            invalid={error !== ""}
            aria-describedby="phone-error"
            onChange={(e) => setPhone(e.target.value)}
          />
          <span id="phone-error" aria-live="polite" className="min-h-4 text-xs text-danger">
            {error}
          </span>
        </Field>
        <Button type="submit" size="lg" block>
          Continue
        </Button>
      </form>
    </main>
  );
}
