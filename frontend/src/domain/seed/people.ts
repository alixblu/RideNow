import type { Role } from "../../identity/types";

/** Fixed reference "now" for seeded data: 2025-06-15T08:00:00+07:00 (Req 7.7). */
export const SEED_NOW = new Date("2025-06-15T08:00:00+07:00");

export interface SeedVehicle {
  model: string;
  plate: string;
  type: "MOTORBIKE" | "CAR";
}

export interface SeedProfile {
  /** Fixed UUID so live-shaped ids remain valid. */
  userId: string;
  role: Role;
  name: string;
  /** Avatar background color (hex). */
  avatarColor: string;
  /** Present for drivers only. */
  vehicle?: SeedVehicle;
}

export const mockProfiles: Readonly<Record<Role, readonly SeedProfile[]>> = {
  rider: [
    { userId: "11111111-1111-4111-8111-000000000001", role: "rider", name: "Nguyen Minh Anh", avatarColor: "#2563eb" },
    { userId: "11111111-1111-4111-8111-000000000002", role: "rider", name: "Tran Quoc Bao", avatarColor: "#db2777" },
    { userId: "11111111-1111-4111-8111-000000000003", role: "rider", name: "Le Thu Ha", avatarColor: "#059669" },
  ],
  driver: [
    {
      userId: "22222222-2222-4222-8222-000000000001",
      role: "driver",
      name: "Pham Van Khoa",
      avatarColor: "#d97706",
      vehicle: { model: "Honda Vision", plate: "59X1-123.45", type: "MOTORBIKE" },
    },
    {
      userId: "22222222-2222-4222-8222-000000000002",
      role: "driver",
      name: "Vo Thanh Tung",
      avatarColor: "#7c3aed",
      vehicle: { model: "Toyota Vios", plate: "51H-678.90", type: "CAR" },
    },
    {
      userId: "22222222-2222-4222-8222-000000000003",
      role: "driver",
      name: "Dang Hoang Nam",
      avatarColor: "#0891b2",
      vehicle: { model: "Yamaha Exciter", plate: "59C2-456.78", type: "MOTORBIKE" },
    },
  ],
  admin: [
    { userId: "33333333-3333-4333-8333-000000000001", role: "admin", name: "Bui Thi Lan", avatarColor: "#dc2626" },
    { userId: "33333333-3333-4333-8333-000000000002", role: "admin", name: "Ngo Duc Huy", avatarColor: "#475569" },
    { userId: "33333333-3333-4333-8333-000000000003", role: "admin", name: "Do Mai Phuong", avatarColor: "#65a30d" },
  ],
};
