/**
 * Recurring flood spots (the "flood-spot log" seed).
 *
 * SAMPLE DATA for the prototype, modelled on the kind of corners that QCDRRMO and MMDA flood
 * advisories name. Positions are approximate: each spot sits at its barangay's centre point
 * moved by (dn metres north, de metres east). Replace these with real sightings; moderators can
 * also add sightings from the Moderation > Flood-spot log page (those are saved in the browser).
 *
 *   b        barangay name, exactly as in locations.json
 *   corner   street or corner as people say it
 *   street   main street name (used to match street cards on the map)
 *   n        number of times it was seen flooded
 *   depth    worst depth, MMDA wording: gutter | tire | knee | waist
 *   pass     who can pass at the worst depth: all | light-no | none
 *   last     date it was last seen flooded (YYYY-MM-DD)
 *   src      where the sighting came from
 */
window.FDA_SPOTS = [
  { b: "Santo Domingo (Matalahib)", corner: "Banawe cor. Retiro", street: "Banawe St.", n: 5, depth: "knee", pass: "light-no", last: "2025-09-29", dn: 20, de: 40, src: "QCDRRMO advisory (sample)" },
  { b: "Santo Domingo (Matalahib)", corner: "Banawe cor. Don Jose", street: "Banawe St.", n: 4, depth: "knee", pass: "light-no", last: "2025-09-29", dn: -30, de: 120, src: "MMDA advisory (sample)" },
  { b: "Santo Domingo (Matalahib)", corner: "Araneta Ave. cor. Ma. Clara", street: "Araneta Ave.", n: 6, depth: "waist", pass: "none", last: "2025-07-21", dn: 140, de: -60, src: "MMDA advisory (sample)" },
  { b: "Santo Domingo (Matalahib)", corner: "N.S. Amoranto cor. Banawe", street: "N.S. Amoranto St.", n: 5, depth: "tire", pass: "light-no", last: "2025-09-29", dn: -120, de: -20, src: "QCDRRMO advisory (sample)" },
  { b: "Santo Domingo (Matalahib)", corner: "Sto. Domingo Ave. cor. Calamba", street: "Sto. Domingo Ave.", n: 3, depth: "knee", pass: "light-no", last: "2025-08-12", dn: 60, de: -150, src: "QCDRRMO advisory (sample)" },
  { b: "Santo Domingo (Matalahib)", corner: "Calamba St. cor. Agno", street: "Calamba St.", n: 2, depth: "tire", pass: "all", last: "2025-07-21", dn: -80, de: 190, src: "MMDA advisory (sample)" },
  { b: "Santo Domingo (Matalahib)", corner: "Don Jose cor. Ma. Clara", street: "Don Jose St.", n: 2, depth: "gutter", pass: "all", last: "2025-06-30", dn: 90, de: 90, src: "MMDA advisory (sample)" },
  { b: "Doña Imelda", corner: "G. Araneta Ave. cor. Doña Hemady", street: "G. Araneta Ave.", n: 7, depth: "waist", pass: "none", last: "2025-09-29", dn: 30, de: 10, src: "MMDA advisory (sample)" },
  { b: "Doña Imelda", corner: "G. Araneta Ave. cor. Tuazon", street: "G. Araneta Ave.", n: 5, depth: "knee", pass: "light-no", last: "2025-08-12", dn: -90, de: 60, src: "QCDRRMO advisory (sample)" },
  { b: "Doña Imelda", corner: "Doña Hemady cor. Aurora Blvd.", street: "Doña Hemady St.", n: 3, depth: "tire", pass: "all", last: "2025-07-21", dn: 110, de: -90, src: "QCDRRMO advisory (sample)" },
  { b: "Talayan", corner: "Quezon Ave. cor. Talayan", street: "Quezon Ave.", n: 4, depth: "knee", pass: "light-no", last: "2025-09-29", dn: 10, de: 20, src: "MMDA advisory (sample)" },
  { b: "Talayan", corner: "Del Monte cor. Talayan", street: "Del Monte Ave.", n: 3, depth: "tire", pass: "all", last: "2025-08-12", dn: -70, de: -80, src: "MMDA advisory (sample)" },
  { b: "Apolonio Samson", corner: "Apolonio Samson cor. Kaingin Rd.", street: "Apolonio Samson Rd.", n: 4, depth: "knee", pass: "light-no", last: "2025-09-29", dn: 20, de: 30, src: "QCDRRMO advisory (sample)" },
  { b: "Apolonio Samson", corner: "Kaingin Rd. cor. Balintawak", street: "Kaingin Rd.", n: 3, depth: "tire", pass: "all", last: "2025-07-21", dn: -100, de: 100, src: "QCDRRMO advisory (sample)" },
  { b: "Masambong", corner: "Del Monte Ave. cor. Mayon", street: "Del Monte Ave.", n: 3, depth: "tire", pass: "all", last: "2025-08-12", dn: 10, de: -20, src: "MMDA advisory (sample)" },
  { b: "Masambong", corner: "Sgt. Esguerra cor. Masambong", street: "Sgt. Esguerra Ave.", n: 3, depth: "knee", pass: "light-no", last: "2025-09-29", dn: -110, de: 80, src: "QCDRRMO advisory (sample)" },
  { b: "Tatalon", corner: "España Blvd. Ext. cor. Tatalon", street: "España Blvd. Ext.", n: 4, depth: "knee", pass: "light-no", last: "2025-09-29", dn: 30, de: 10, src: "QCDRRMO advisory (sample)" },
  { b: "Tatalon", corner: "Gen. Luis cor. Tatalon", street: "Tatalon St.", n: 2, depth: "gutter", pass: "all", last: "2025-06-30", dn: -60, de: 90, src: "QCDRRMO advisory (sample)" },
  { b: "Siena", corner: "Banawe cor. Siena", street: "Banawe St.", n: 3, depth: "tire", pass: "all", last: "2025-08-12", dn: 0, de: 0, src: "MMDA advisory (sample)" },
  { b: "Saint Peter", corner: "Banawe cor. Saint Peter", street: "Banawe St.", n: 3, depth: "knee", pass: "light-no", last: "2025-09-29", dn: 20, de: -30, src: "MMDA advisory (sample)" },
  { b: "Saint Peter", corner: "Calamba St. cor. Saint Peter", street: "Calamba St.", n: 2, depth: "tire", pass: "all", last: "2025-07-21", dn: -70, de: 60, src: "QCDRRMO advisory (sample)" },
  { b: "Damayang Lagi", corner: "E. Rodriguez Sr. Ave. cor. Damayang Lagi", street: "E. Rodriguez Sr. Ave.", n: 3, depth: "tire", pass: "all", last: "2025-08-12", dn: 0, de: 0, src: "MMDA advisory (sample)" },
  { b: "Laging Handa", corner: "Tomas Morato cor. Scout Tuason", street: "Tomas Morato Ave.", n: 4, depth: "knee", pass: "light-no", last: "2025-09-29", dn: 10, de: -30, src: "MMDA advisory (sample)" },
  { b: "Laging Handa", corner: "Timog Ave. cor. Scout Borromeo", street: "Timog Ave.", n: 2, depth: "tire", pass: "all", last: "2025-08-12", dn: -50, de: 80, src: "MMDA advisory (sample)" },
  { b: "Sacred Heart", corner: "Quezon Ave. cor. Scout Madriñan", street: "Quezon Ave.", n: 3, depth: "tire", pass: "all", last: "2025-08-12", dn: 0, de: 0, src: "MMDA advisory (sample)" },
  { b: "Kamuning", corner: "K-1st cor. Kamuning Rd.", street: "Kamuning Rd.", n: 2, depth: "tire", pass: "all", last: "2025-07-21", dn: 0, de: 0, src: "QCDRRMO advisory (sample)" },
  { b: "Culiat", corner: "Tandang Sora Ave. cor. Mindanao Ave.", street: "Tandang Sora Ave.", n: 5, depth: "knee", pass: "light-no", last: "2025-09-29", dn: 30, de: 20, src: "QCDRRMO advisory (sample)" },
  { b: "Culiat", corner: "Mindanao Ave. cor. Visayas Ave.", street: "Mindanao Ave.", n: 3, depth: "tire", pass: "all", last: "2025-08-12", dn: -90, de: 100, src: "MMDA advisory (sample)" },
  { b: "Tandang Sora", corner: "Tandang Sora Ave. cor. Visayas Ave.", street: "Tandang Sora Ave.", n: 4, depth: "knee", pass: "light-no", last: "2025-09-29", dn: 10, de: 10, src: "QCDRRMO advisory (sample)" },
  { b: "Tandang Sora", corner: "Commonwealth Ave. cor. Tandang Sora", street: "Commonwealth Ave.", n: 3, depth: "tire", pass: "all", last: "2025-08-12", dn: 110, de: -70, src: "MMDA advisory (sample)" },
  { b: "Bahay Toro", corner: "Visayas Ave. cor. Congressional Ave.", street: "Visayas Ave.", n: 3, depth: "tire", pass: "all", last: "2025-08-12", dn: 0, de: 0, src: "MMDA advisory (sample)" },
  { b: "Vasra", corner: "Visayas Ave. cor. Vasra", street: "Visayas Ave.", n: 2, depth: "gutter", pass: "all", last: "2025-07-21", dn: 0, de: 0, src: "QCDRRMO advisory (sample)" },
  { b: "Maharlika", corner: "Maharlika cor. Tandang Sora", street: "Maharlika St.", n: 2, depth: "tire", pass: "all", last: "2025-07-21", dn: 0, de: 0, src: "QCDRRMO advisory (sample)" },
  { b: "Bagong Silangan", corner: "Payatas Rd. cor. Bagong Silangan", street: "Payatas Rd.", n: 3, depth: "knee", pass: "light-no", last: "2025-09-29", dn: 0, de: 0, src: "QCDRRMO advisory (sample)" },
  { b: "Payatas", corner: "Payatas Rd. cor. Litex", street: "Payatas Rd.", n: 3, depth: "tire", pass: "all", last: "2025-08-12", dn: 0, de: 0, src: "QCDRRMO advisory (sample)" },
  { b: "Batasan Hills", corner: "Commonwealth Ave. cor. Batasan Rd.", street: "Commonwealth Ave.", n: 3, depth: "tire", pass: "all", last: "2025-08-12", dn: 0, de: 0, src: "MMDA advisory (sample)" },
  { b: "Libis", corner: "C.P. Garcia Ave. cor. Libis", street: "C.P. Garcia Ave.", n: 3, depth: "tire", pass: "all", last: "2025-08-12", dn: 0, de: 0, src: "MMDA advisory (sample)" },
  { b: "Project 6", corner: "Congressional Ave. cor. Mindanao Ave.", street: "Congressional Ave.", n: 2, depth: "gutter", pass: "all", last: "2025-06-30", dn: 0, de: 0, src: "QCDRRMO advisory (sample)" },
  { b: "Old Capitol Site", corner: "Kalayaan cor. Elliptical Rd.", street: "Kalayaan Ave.", n: 2, depth: "gutter", pass: "all", last: "2025-06-30", dn: 0, de: 0, src: "MMDA advisory (sample)" },
  { b: "Pasong Tamo", corner: "Tandang Sora Ave. cor. Pasong Tamo", street: "Tandang Sora Ave.", n: 3, depth: "tire", pass: "all", last: "2025-08-12", dn: 0, de: 0, src: "QCDRRMO advisory (sample)" }
];
