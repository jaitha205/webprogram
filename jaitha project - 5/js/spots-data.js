/**
 * Spot dataset + terrain/mood vocab for the Recon UI.
 * NOTE: solitude scores, best windows, cautions and entry-point coordinates are
 * illustrative seed values. Verify on the ground and correct them via the Field Log.
 */

window.MOODS = {
  relax:     { icon: '🌿', label: 'Relax' },
  romantic:  { icon: '✨', label: 'Romantic' },
  adventure: { icon: '⛰️', label: 'Adventure' }
};

// factor = estimated road-distance multiplier over straight-line distance
window.ACCESS_TYPES = {
  paved:    { icon: '🛣️', label: 'Paved Highway', factor: 1.15 },
  dirt:     { icon: '🟤', label: 'Dirt Track',    factor: 1.35 },
  footpath: { icon: '🥾', label: 'Forest Footpath', factor: 1.5 },
  fourx4:   { icon: '🚙', label: '4x4 Required',  factor: 1.6 }
};

window.CAUTIONS = {
  steps:    { icon: '🪜', label: 'Steep Steps' },
  mud:      { icon: '🌧️', label: 'Monsoon Mud' },
  nosignal: { icon: '📵', label: 'No Cellular Signal' }
};

window.KIND_META = {
  destination: { icon: '🎯', label: 'Destination' },
  parking:     { icon: '🅿️', label: 'Parking' },
  entry:       { icon: '🚪', label: 'Entry Point' }
};

// Quiet Index: 0-100 solitude score -> label
window.quietInfo = function (score) {
  if (score >= 70) return { key: 'silent',   icon: '🌿', label: 'Silent',   color: '#10b981' };
  if (score >= 40) return { key: 'moderate', icon: '👥', label: 'Moderate', color: '#f59e0b' };
  return               { key: 'busy',     icon: '⚠️', label: 'Busy',     color: '#f43f5e' };
};

window.SEED_SPOTS = [
  // CHENNAI & NEARBY
  { id: "spot-1", name: "Broken Bridge Sunset Point", city: "Chennai", lat: 13.0012, lng: 80.2721,
    mood: "romantic", difficulty: "easy", access: "paved", cautions: ["mud"],
    solitude: 45, bestWindow: "6:00 AM sunrise; skip weekend evenings",
    description: "Quiet estuarine spot at Adyar river mouth. Flat access road, excellent evening breeze.", rating: 4.8,
    entries: [{ id: "spot-1-p", kind: "parking", name: "Roadside parking", lat: 13.0035, lng: 80.2700 }] },
  { id: "spot-2", name: "Muttukadu Backwater Edge", city: "Chennai / ECR", lat: 12.8228, lng: 80.2435,
    mood: "relax", difficulty: "easy", access: "paved", cautions: [],
    solitude: 60, bestWindow: "Weekday 6:30 AM, calm water & birds",
    description: "Hidden coastal greenery route away from main ECR highway traffic.", rating: 4.7 },
  { id: "spot-3", name: "Pulicat Salt Lagoon Sanctuary", city: "Tiruvallur", lat: 13.4188, lng: 80.3185,
    mood: "adventure", difficulty: "moderate", access: "dirt", cautions: ["mud", "nosignal"],
    solitude: 88, bestWindow: "Nov–Feb, 6:00 AM for flamingos",
    description: "Remote northern saltwater lagoon with seasonal flamingo sightings.", rating: 4.9,
    entries: [{ id: "spot-3-e", kind: "entry", name: "Lagoon track gate", lat: 13.4130, lng: 80.3140 }] },
  { id: "spot-4", name: "Semmozhi Poonga Inner Canopy", city: "Chennai Central", lat: 13.0519, lng: 80.2505,
    mood: "relax", difficulty: "easy", access: "paved", cautions: [],
    solitude: 35, bestWindow: "Weekday 7:00 AM, before office crowds",
    description: "Paved botanical walking trails shielded from city street noise.", rating: 4.6 },

  // HOSUR
  { id: "spot-hosur-1", name: "Keligiri Reservoir Viewpoint", city: "Hosur", lat: 12.7210, lng: 77.8115,
    mood: "relax", difficulty: "easy", access: "paved", cautions: [],
    solitude: 72, bestWindow: "5:45 PM golden hour on weekdays",
    description: "Serene lakeside sunset retreat, easily accessible via Hosur town ring road.", rating: 4.7 },
  { id: "spot-hosur-2", name: "Rajaji Memorial Hill & Rock Cut", city: "Thorapalli (Hosur)", lat: 12.6502, lng: 77.8821,
    mood: "adventure", difficulty: "moderate", access: "footpath", cautions: ["steps"],
    solitude: 80, bestWindow: "6:00 AM, cool and empty",
    description: "Quiet heritage hillock offering 360-degree views of countryside farms.", rating: 4.8,
    entries: [{ id: "spot-hosur-2-p", kind: "parking", name: "Base parking", lat: 12.6480, lng: 77.8790 }] },

  // BANGALORE & KARNATAKA
  { id: "spot-blr-1", name: "Gudibande Fort Ridge Trail", city: "Chikkaballapur / Blr", lat: 13.6706, lng: 77.7011,
    mood: "adventure", difficulty: "moderate", access: "footpath", cautions: ["steps", "nosignal"],
    solitude: 90, bestWindow: "Sunrise, carry water",
    description: "Lesser-known 17th-century rock fort with rainwater harvesting cisterns.", rating: 4.8,
    entries: [{ id: "spot-blr-1-p", kind: "parking", name: "Village parking", lat: 13.6685, lng: 77.6985 }] },
  { id: "spot-blr-2", name: "Hessarghatta Grasslands Cove", city: "Bangalore North", lat: 13.1534, lng: 77.4891,
    mood: "relax", difficulty: "easy", access: "dirt", cautions: ["mud"],
    solitude: 65, bestWindow: "Weekday 6:30 AM, misty grass",
    description: "Expansive savanna-like lakebed grass fields ideal for peaceful morning strolls.", rating: 4.7 },

  // OOTY
  { id: "spot-ooty-1", name: "Avalanche Lake Pine Forest Trail", city: "Ooty", lat: 11.3121, lng: 76.5821,
    mood: "romantic", difficulty: "easy", access: "paved", cautions: ["mud"],
    solitude: 55, bestWindow: "7:00 AM, mist and empty paths",
    description: "Dense pine canopy with cool misty air and tranquil stream paths.", rating: 4.9 },
  { id: "spot-ooty-2", name: "Needle Rock Viewpoint", city: "Gudalur / Ooty", lat: 11.4892, lng: 76.4912,
    mood: "adventure", difficulty: "moderate", access: "footpath", cautions: ["steps", "nosignal"],
    solitude: 78, bestWindow: "Before 8:00 AM, before clouds close in",
    description: "Conical 360-degree hill peak above the clouds overlooking Western Ghats valley.", rating: 4.9,
    entries: [{ id: "spot-ooty-2-e", kind: "entry", name: "Trailhead", lat: 11.4870, lng: 76.4890 }] },

  // KODAIKANAL & MUNNAR
  { id: "spot-kodai-1", name: "Mannavanur Sheep Farm Lake", city: "Kodaikanal", lat: 10.2521, lng: 77.3512,
    mood: "relax", difficulty: "easy", access: "dirt", cautions: ["mud", "nosignal"],
    solitude: 82, bestWindow: "6:30 AM, meadow fog",
    description: "Lush rolling green meadows reminiscent of European countryside.", rating: 4.9 },
  { id: "spot-munnar-1", name: "Lockhart Gap Secret Tea Valley", city: "Munnar", lat: 10.0421, lng: 77.1215,
    mood: "romantic", difficulty: "easy", access: "paved", cautions: [],
    solitude: 40, bestWindow: "6:00 AM, cloud layers, few tourists",
    description: "Breathtaking tea plantation valley with frequent cloud layers.", rating: 4.8 },

  // GOA
  { id: "spot-goa-1", name: "Butterfly Beach Hidden Bay", city: "South Goa", lat: 15.0028, lng: 74.0019,
    mood: "romantic", difficulty: "moderate", access: "footpath", cautions: ["steps", "nosignal"],
    solitude: 62, bestWindow: "Weekday 8:00 AM, calm sea",
    description: "Secluded semi-circular cove accessible via short forest path or boat.", rating: 4.9,
    entries: [{ id: "spot-goa-1-e", kind: "entry", name: "Forest path start", lat: 15.0060, lng: 74.0040 }] }
];
