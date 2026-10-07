// Local government areas for USSD reporting. USSD cannot send a location, so a report is placed
// at the area's approximate centre and always checked by a moderator before it is shown.
// The centres are approximate (to about 2 km) and should be checked before launch.

export interface Area {
  name: string;
  lat: number;
  lng: number;
}

export interface Region {
  name: string;
  areas: Area[];
}

export const USSD_REGIONS: Region[] = [
  {
    name: "Lagos",
    areas: [
      { name: "Agege", lat: 6.618, lng: 3.321 },
      { name: "Ajeromi-Ifelodun", lat: 6.455, lng: 3.334 },
      { name: "Alimosho", lat: 6.584, lng: 3.257 },
      { name: "Amuwo-Odofin", lat: 6.459, lng: 3.276 },
      { name: "Apapa", lat: 6.449, lng: 3.359 },
      { name: "Badagry", lat: 6.43, lng: 2.888 },
      { name: "Epe", lat: 6.584, lng: 3.983 },
      { name: "Eti-Osa", lat: 6.45, lng: 3.55 },
      { name: "Ibeju-Lekki", lat: 6.47, lng: 3.85 },
      { name: "Ifako-Ijaiye", lat: 6.663, lng: 3.299 },
      { name: "Ikeja", lat: 6.602, lng: 3.352 },
      { name: "Ikorodu", lat: 6.619, lng: 3.511 },
      { name: "Kosofe", lat: 6.59, lng: 3.4 },
      { name: "Lagos Island", lat: 6.454, lng: 3.395 },
      { name: "Lagos Mainland", lat: 6.492, lng: 3.382 },
      { name: "Mushin", lat: 6.527, lng: 3.354 },
      { name: "Ojo", lat: 6.463, lng: 3.17 },
      { name: "Oshodi-Isolo", lat: 6.536, lng: 3.33 },
      { name: "Shomolu", lat: 6.539, lng: 3.384 },
      { name: "Surulere", lat: 6.5, lng: 3.35 },
    ],
  },
  {
    name: "Abuja (FCT)",
    areas: [
      { name: "Abuja Municipal", lat: 9.058, lng: 7.495 },
      { name: "Bwari", lat: 9.283, lng: 7.383 },
      { name: "Gwagwalada", lat: 8.942, lng: 7.083 },
      { name: "Kuje", lat: 8.879, lng: 7.227 },
      { name: "Kwali", lat: 8.75, lng: 7.0 },
      { name: "Abaji", lat: 8.474, lng: 6.943 },
    ],
  },
];

/** Short names that fit a USSD screen. */
export const USSD_CATEGORIES: { id: string; name: string }[] = [
  { id: "armed_robbery", name: "Armed robbery" },
  { id: "kidnapping", name: "Kidnapping" },
  { id: "gunfire_heard", name: "Gunshots heard" },
  { id: "fire", name: "Fire" },
  { id: "crash", name: "Road crash" },
  { id: "flood", name: "Flood" },
  { id: "riot", name: "Riot or clash" },
  { id: "building_collapse", name: "Building collapse" },
];
