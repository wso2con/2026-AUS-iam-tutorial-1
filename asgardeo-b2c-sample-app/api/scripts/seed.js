import Database from "better-sqlite3";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(__dirname, "..");
const configuredDbPath = "wayfinder.sqlite";
const dbPath = resolve(apiRoot, configuredDbPath);
const schemaPath = resolve(apiRoot, "schema.sql");
const forceSeed = process.argv.includes("--force") || process.argv.includes("-f");

const flights = [
  {
    id: "flight-nyc-lax-01",
    from: "New York",
    to: "Los Angeles",
    airline: "Horizon Airlines",
    departure_time: "08:00",
    arrival_time: "11:30",
    duration: "5h 30m",
    stops: 0,
    price: 268,
    currency: "USD",
    cabin: "Economy",
    dates: "Jun 12 - Jun 18",
    tags: JSON.stringify(["Best value", "Nonstop"])
  },
  {
    id: "flight-chi-mia-01",
    from: "Chicago",
    to: "Miami",
    airline: "American Air",
    departure_time: "10:15",
    arrival_time: "14:45",
    duration: "3h 30m",
    stops: 0,
    price: 245,
    currency: "USD",
    cabin: "Economy",
    dates: "Jul 04 - Jul 16",
    tags: JSON.stringify(["Nonstop", "Popular"])
  },
  {
    id: "flight-sfo-sea-01",
    from: "San Francisco",
    to: "Seattle",
    airline: "West Coast Express",
    departure_time: "14:20",
    arrival_time: "16:10",
    duration: "2h 50m",
    stops: 0,
    price: 156,
    currency: "USD",
    cabin: "Economy",
    dates: "Aug 21 - Aug 27",
    tags: JSON.stringify(["Quick trip"])
  },
  {
    id: "flight-bos-fll-01",
    from: "Boston",
    to: "Fort Lauderdale",
    airline: "East Coast Airways",
    departure_time: "11:45",
    arrival_time: "15:20",
    duration: "3h 35m",
    stops: 0,
    price: 224,
    currency: "USD",
    cabin: "Economy",
    dates: "Jun 20 - Jun 26",
    tags: JSON.stringify(["Beach trip"])
  },
  {
    id: "flight-den-las-01",
    from: "Denver",
    to: "Las Vegas",
    airline: "Mountain Air",
    departure_time: "09:30",
    arrival_time: "10:45",
    duration: "2h 15m",
    stops: 0,
    price: 132,
    currency: "USD",
    cabin: "Economy",
    dates: "Jun 12 - Jun 18",
    tags: JSON.stringify(["Budget flight", "Direct"])
  },
  {
    id: "flight-phx-nyc-01",
    from: "Phoenix",
    to: "New York",
    airline: "Horizon Airlines",
    departure_time: "13:00",
    arrival_time: "20:15",
    duration: "4h 15m",
    stops: 0,
    price: 289,
    currency: "USD",
    cabin: "Economy",
    dates: "Jun 12 - Jun 18",
    tags: JSON.stringify(["Flexible ticket", "Carry-on included"])
  },
  {
    id: "flight-dal-msy-01",
    from: "Dallas",
    to: "New Orleans",
    airline: "Southern Sky",
    departure_time: "07:15",
    arrival_time: "09:45",
    duration: "2h 30m",
    stops: 0,
    price: 147,
    currency: "USD",
    cabin: "Economy",
    dates: "Jul 04 - Jul 16",
    tags: JSON.stringify(["Good price", "Morning"])
  },
  {
    id: "flight-lax-san-01",
    from: "Los Angeles",
    to: "San Diego",
    airline: "SunFly",
    departure_time: "15:30",
    arrival_time: "16:20",
    duration: "1h 50m",
    stops: 0,
    price: 98,
    currency: "USD",
    cabin: "Economy",
    dates: "Sep 02 - Sep 09",
    tags: JSON.stringify(["Shortest flight", "Budget"])
  },
  {
    id: "flight-nyc-lax-02",
    from: "New York",
    to: "Los Angeles",
    airline: "Blue Sky Airlines",
    departure_time: "20:45",
    arrival_time: "00:20",
    duration: "5h 35m",
    stops: 0,
    price: 298,
    currency: "USD",
    cabin: "Economy",
    dates: "Jun 12 - Jun 18",
    tags: JSON.stringify(["Evening", "Red-eye"])
  },
  {
    id: "flight-chi-mia-02",
    from: "Chicago",
    to: "Miami",
    airline: "Star Airways",
    departure_time: "16:00",
    arrival_time: "20:30",
    duration: "3h 30m",
    stops: 0,
    price: 198,
    currency: "USD",
    cabin: "Economy",
    dates: "Oct 10 - Oct 18",
    tags: JSON.stringify(["Afternoon", "Nonstop"])
  }
];

const hotels = [
  {
    id: "hotel-la-marina-resort",
    name: "LA Marina Resort",
    location: "Los Angeles Marina",
    nightly_rate: 148,
    currency: "USD",
    rating: 9.1,
    amenities: JSON.stringify(["Beachfront", "Pool", "Gym"])
  },
  {
    id: "hotel-miami-beach-palace",
    name: "Miami Beach Palace",
    location: "Miami Beach",
    nightly_rate: 156,
    currency: "USD",
    rating: 8.8,
    amenities: JSON.stringify(["Ocean view", "Spa", "Restaurant"])
  },
  {
    id: "hotel-midtown-manhattan",
    name: "Midtown Manhattan Lofts",
    location: "New York Manhattan",
    nightly_rate: 218,
    currency: "USD",
    rating: 9.4,
    amenities: JSON.stringify(["Central location", "Fitness center", "Concierge"])
  },
  {
    id: "hotel-chicago-downtown",
    name: "Chicago Downtown Inn",
    location: "Chicago Downtown",
    nightly_rate: 128,
    currency: "USD",
    rating: 8.9,
    amenities: JSON.stringify(["Loop location", "Breakfast", "Business center"])
  },
  {
    id: "hotel-sf-union-square",
    name: "Union Square Hotel",
    location: "San Francisco Union Square",
    nightly_rate: 174,
    currency: "USD",
    rating: 8.7,
    amenities: JSON.stringify(["Shopping district", "Restaurant", "Workout room"])
  },
  {
    id: "hotel-boston-backbay",
    name: "Boston Back Bay Suites",
    location: "Boston Back Bay",
    nightly_rate: 149,
    currency: "USD",
    rating: 9.0,
    amenities: JSON.stringify(["Historic area", "Parking", "Free WiFi"])
  },
  {
    id: "hotel-seattle-waterfront",
    name: "Seattle Waterfront Lodge",
    location: "Seattle Waterfront",
    nightly_rate: 162,
    currency: "USD",
    rating: 9.2,
    amenities: JSON.stringify(["Waterfront views", "Restaurant", "Business services"])
  },
  {
    id: "hotel-vegas-strip-view",
    name: "Vegas Strip View Hotel",
    location: "Las Vegas Strip",
    nightly_rate: 118,
    currency: "USD",
    rating: 8.6,
    amenities: JSON.stringify(["Strip access", "Casino", "Entertainment"])
  },
  {
    id: "hotel-denver-downtown",
    name: "Denver Downtown Hotel",
    location: "Denver Downtown",
    nightly_rate: 119,
    currency: "USD",
    rating: 8.5,
    amenities: JSON.stringify(["Downtown location", "Fitness center", "Breakfast"])
  },
  {
    id: "hotel-sanDiego-harbor",
    name: "San Diego Harbor Inn",
    location: "San Diego Harbor",
    nightly_rate: 138,
    currency: "USD",
    rating: 8.9,
    amenities: JSON.stringify(["Bay views", "Waterfront dining", "Concierge"])
  }
];

const trips = [
  {
    id: "trip-la-getaway",
    title: "Los Angeles beach getaway",
    destination: "Los Angeles",
    flight_id: "flight-nyc-lax-01",
    hotel_id: "hotel-la-marina-resort",
    status: "planning",
    total_estimate: 966,
    currency: "USD"
  },
  {
    id: "trip-miami-week",
    title: "Miami sunshine week",
    destination: "Miami",
    flight_id: "flight-chi-mia-01",
    hotel_id: "hotel-miami-beach-palace",
    status: "saved",
    total_estimate: 924,
    currency: "USD"
  },
  {
    id: "trip-nyc-city-escape",
    title: "New York city escape",
    destination: "New York",
    flight_id: "flight-phx-nyc-01",
    hotel_id: "hotel-midtown-manhattan",
    status: "planning",
    total_estimate: 1726,
    currency: "USD"
  },
  {
    id: "trip-chicago-break",
    title: "Chicago city break",
    destination: "Chicago",
    flight_id: "flight-chi-mia-02",
    hotel_id: "hotel-chicago-downtown",
    status: "saved",
    total_estimate: 524,
    currency: "USD"
  },
  {
    id: "trip-sf-tech-tour",
    title: "San Francisco tech tour",
    destination: "San Francisco",
    flight_id: "flight-sfo-sea-01",
    hotel_id: "hotel-sf-union-square",
    status: "planning",
    total_estimate: 696,
    currency: "USD"
  },
  {
    id: "trip-boston-historic",
    title: "Boston historic tour",
    destination: "Boston",
    flight_id: "flight-bos-fll-01",
    hotel_id: "hotel-boston-backbay",
    status: "saved",
    total_estimate: 820,
    currency: "USD"
  }
];

if (!existsSync(apiRoot)) {
  mkdirSync(apiRoot, { recursive: true });
}

if (forceSeed) {
  for (const path of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    if (existsSync(path)) {
      rmSync(path, { force: true });
    }
  }
}

const db = new Database(dbPath);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(readFileSync(schemaPath, "utf8"));

const insertFlight = db.prepare(`
  INSERT INTO flights (
    id,
    from_city,
    to_city,
    airline,
    departure_time,
    arrival_time,
    duration,
    stops,
    price,
    currency,
    cabin,
    dates,
    tags
  ) VALUES (
    @id,
    @from,
    @to,
    @airline,
    @departure_time,
    @arrival_time,
    @duration,
    @stops,
    @price,
    @currency,
    @cabin,
    @dates,
    @tags
  )
`);

const insertHotel = db.prepare(`
  INSERT INTO hotels (
    id,
    name,
    location,
    nightly_rate,
    currency,
    rating,
    amenities
  ) VALUES (
    @id,
    @name,
    @location,
    @nightly_rate,
    @currency,
    @rating,
    @amenities
  )
`);

const insertTrip = db.prepare(`
  INSERT INTO trips (
    id,
    title,
    destination,
    flight_id,
    hotel_id,
    status,
    total_estimate,
    currency
  ) VALUES (
    @id,
    @title,
    @destination,
    @flight_id,
    @hotel_id,
    @status,
    @total_estimate,
    @currency
  )
`);

const seed = db.transaction(() => {
  for (const flight of flights) {
    insertFlight.run(flight);
  }

  for (const hotel of hotels) {
    insertHotel.run(hotel);
  }

  for (const trip of trips) {
    insertTrip.run(trip);
  }
});

seed();
db.close();

console.log(`Seeded SQLite database at ${dbPath}${forceSeed ? " after force reset" : ""}`);
