/**
 * AccountScreen — rider profile, payment method summary and sign-out (Req 4.10, 2.7).
 */
import { CreditCard } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { SIGN_IN_PATH } from "../../identity/guard";
import { mockProfiles } from "../../identity/mockProfiles";
import { useCurrentIdentity } from "../../identity/useCurrentIdentity";
import { Avatar, Button, Card, CardBody } from "../../shared/ui";

export function AccountScreen() {
  const { identity, signOut } = useCurrentIdentity();
  const navigate = useNavigate();
  const profile = mockProfiles.rider.find((p) => p.userId === identity?.id);
  const name = profile?.name ?? "Rider";

  const handleSignOut = () => {
    signOut();
    navigate(SIGN_IN_PATH, { replace: true });
  };

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <h1 className="text-2xl font-bold">Account</h1>
      <Card>
        <CardBody className="flex items-center gap-4 pt-5">
          <Avatar name={name} size="lg" />
          <div className="min-w-0">
            <p className="truncate text-lg font-bold">{name}</p>
            <p className="text-sm text-content-muted">Rider</p>
          </div>
        </CardBody>
      </Card>
      <Card>
        <CardBody className="flex items-center gap-3 pt-5">
          <CreditCard className="h-6 w-6 text-content-muted" aria-hidden="true" />
          <div>
            <h2 className="text-xs font-semibold uppercase text-content-muted">Payment method</h2>
            <p className="text-sm font-semibold">Cash</p>
          </div>
        </CardBody>
      </Card>
      <Button variant="danger" size="lg" block onClick={handleSignOut}>
        Sign out
      </Button>
    </div>
  );
}
