/**
 * Feature: frontend-booking-and-password-login, Property 8: Sign-up and login
 * forms never submit with an invalid field
 *
 * **Validates: Requirements 3.6**
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import fc from "fast-check";
import { IdentityContext } from "../identity/IdentityContext";
import type { IdentityApi } from "../identity/types";
import * as authApi from "./authApi";
import { SignInScreen } from "./SignInScreen";
import { SignUpScreen } from "./SignUpScreen";
import { validateEmail, validateFullName, validatePassword } from "./validate";

vi.mock("./authApi", async () => {
  const actual = await vi.importActual<typeof import("./authApi")>("./authApi");
  return { ...actual, register: vi.fn(), login: vi.fn() };
});

const alnum = fc.stringMatching(/^[a-z0-9]{1,10}$/);

const validEmail = fc.tuple(alnum, alnum, alnum).map(([a, b, c]) => `${a}@${b}.${c}`);
const invalidEmail = fc.oneof(
  fc.constantFrom("", " ", "   "),
  fc.stringMatching(/^[a-zA-Z0-9 .]{1,20}$/), // no "@"
  fc.tuple(alnum, alnum).map(([a, b]) => `${a}@${b}`), // no dot in domain
);

const validPassword = fc.stringMatching(/^[A-Za-z0-9]{8,72}$/);
const invalidPassword = fc.string({ maxLength: 7 });

const validName = alnum;
const invalidName = fc.constantFrom("", " ", "    ");

/** Draws one value per field and guarantees at least one is invalid. */
function formArb(fields: Array<"fullName" | "email" | "password">) {
  const perField = (f: "fullName" | "email" | "password") =>
    f === "fullName"
      ? fc.tuple(fc.boolean(), validName, invalidName)
      : f === "email"
        ? fc.tuple(fc.boolean(), validEmail, invalidEmail)
        : fc.tuple(fc.boolean(), validPassword, invalidPassword);
  return fc
    .tuple(...fields.map(perField))
    .filter((parts) => parts.some(([isInvalid]) => isInvalid))
    .map((parts) => {
      const out: Record<string, string> = { fullName: "", email: "", password: "" };
      fields.forEach((f, i) => {
        const [isInvalid, good, bad] = parts[i]!;
        out[f] = isInvalid ? bad : good;
      });
      return out as { fullName: string; email: string; password: string };
    });
}

const identityApi: IdentityApi = {
  identity: null,
  signIn: vi.fn(),
  signOut: vi.fn(),
  current: () => null,
};

function mount(ui: React.ReactElement) {
  return render(
    <IdentityContext.Provider value={identityApi}>
      <MemoryRouter>{ui}</MemoryRouter>
    </IdentityContext.Provider>,
  );
}

function setValue(el: HTMLElement, value: string) {
  fireEvent.change(el, { target: { value } });
}

describe("Property 8: forms never submit with an invalid field", () => {
  beforeEach(() => {
    vi.mocked(authApi.register).mockReset();
    vi.mocked(authApi.login).mockReset();
  });
  afterEach(cleanup);

  it("pure validators flag exactly the invalid fields", () => {
    fc.assert(
      fc.property(formArb(["fullName", "email", "password"]), (form) => {
        const errors = [
          validateFullName(form.fullName),
          validateEmail(form.email),
          validatePassword(form.password),
        ].filter((e) => e !== null);
        expect(errors.length).toBeGreaterThan(0);
        for (const e of errors) expect(e!.message.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 },
    );
  });

  it("sign-up never calls register when any field is invalid", () => {
    fc.assert(
      fc.property(formArb(["fullName", "email", "password"]), (form) => {
        const { container, unmount } = mount(<SignUpScreen />);
        setValue(container.querySelector("#signup-name")!, form.fullName);
        setValue(container.querySelector("#signup-email")!, form.email);
        setValue(container.querySelector("#signup-password")!, form.password);
        fireEvent.submit(container.querySelector("form")!);

        expect(authApi.register).not.toHaveBeenCalled();
        const expected = [
          validateFullName(form.fullName),
          validateEmail(form.email),
          validatePassword(form.password),
        ].filter((e) => e !== null);
        for (const e of expected) expect(container.textContent).toContain(e!.message);
        unmount();
      }),
      { numRuns: 100 },
    );
  });

  it("sign-in never calls login when any field is invalid", () => {
    fc.assert(
      fc.property(formArb(["email", "password"]), (form) => {
        const { container, unmount } = mount(<SignInScreen />);
        setValue(container.querySelector("#signin-email")!, form.email);
        setValue(container.querySelector("#signin-password")!, form.password);
        fireEvent.submit(container.querySelector("form")!);

        expect(authApi.login).not.toHaveBeenCalled();
        const expected = [validateEmail(form.email), validatePassword(form.password)].filter(
          (e) => e !== null,
        );
        for (const e of expected) expect(container.textContent).toContain(e!.message);
        unmount();
      }),
      { numRuns: 100 },
    );
  });
});
