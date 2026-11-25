/** Password input with a show/hide control (Req 3.2, 3.3). */
import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Field, Input } from "../shared/ui";

interface PasswordFieldProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  error?: string | undefined;
  autoComplete: "current-password" | "new-password";
  disabled?: boolean;
}

export function PasswordField({
  id,
  value,
  onChange,
  error,
  autoComplete,
  disabled,
}: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  return (
    <Field htmlFor={id} label="Password" error={error}>
      <div className="relative">
        <Input
          id={id}
          type={visible ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          invalid={Boolean(error)}
          autoComplete={autoComplete}
          disabled={disabled}
          className="pr-14"
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
          className="absolute right-0 top-0 flex h-12 min-h-11 w-12 min-w-11 items-center justify-center rounded-xl text-content-muted hover:text-content"
        >
          {visible ? (
            <EyeOff className="h-5 w-5" aria-hidden="true" />
          ) : (
            <Eye className="h-5 w-5" aria-hidden="true" />
          )}
        </button>
      </div>
    </Field>
  );
}
