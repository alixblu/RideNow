/** A named place a rider can pick instead of typing coordinates. */
export interface PresetLocation {
  /** Stable key used as the <option> value. */
  id: string;
  label: string;
  address: string;
  lat: number;
  lng: number;
}

/** Real Ho Chi Minh City landmarks with addresses and coordinates. */
export const PRESET_LOCATIONS: readonly PresetLocation[] = [
  { id: "ben-thanh", label: "Ben Thanh Market", address: "Le Loi, Ben Thanh Ward, District 1", lat: 10.7725, lng: 106.698 },
  { id: "notre-dame", label: "Notre-Dame Cathedral", address: "01 Cong xa Paris, Ben Nghe Ward, District 1", lat: 10.7797, lng: 106.699 },
  { id: "bitexco", label: "Bitexco Financial Tower", address: "2 Hai Trieu, Ben Nghe Ward, District 1", lat: 10.7718, lng: 106.7043 },
  { id: "tan-son-nhat", label: "Tan Son Nhat Airport", address: "Truong Son, Ward 2, Tan Binh District", lat: 10.8188, lng: 106.6519 },
  { id: "landmark-81", label: "Landmark 81", address: "720A Dien Bien Phu, Ward 22, Binh Thanh District", lat: 10.7949, lng: 106.7218 },
  { id: "thao-dien", label: "Thao Dien", address: "Xuan Thuy, Thao Dien Ward, Thu Duc City", lat: 10.8036, lng: 106.7406 },
  { id: "independence-palace", label: "Independence Palace", address: "135 Nam Ky Khoi Nghia, Ben Thanh Ward, District 1", lat: 10.7770, lng: 106.6953 },
  { id: "saigon-zoo", label: "Saigon Zoo and Botanical Garden", address: "2 Nguyen Binh Khiem, Ben Nghe Ward, District 1", lat: 10.7875, lng: 106.7054 },
  { id: "cho-lon", label: "Binh Tay Market", address: "57A Thap Muoi, Ward 2, District 6", lat: 10.7506, lng: 106.6500 },
  { id: "pham-ngu-lao", label: "Pham Ngu Lao Street", address: "Pham Ngu Lao, District 1", lat: 10.7676, lng: 106.6935 },
];
