DROP TABLE IF EXISTS deal_alert_consents;
DROP TABLE IF EXISTS bookings;
DROP TABLE IF EXISTS trips;
DROP TABLE IF EXISTS hotels;
DROP TABLE IF EXISTS flights;

CREATE TABLE flights (
  id TEXT PRIMARY KEY,
  from_city TEXT NOT NULL,
  to_city TEXT NOT NULL,
  airline TEXT NOT NULL,
  departure_time TEXT NOT NULL,
  arrival_time TEXT NOT NULL,
  duration TEXT NOT NULL,
  stops INTEGER NOT NULL,
  price REAL NOT NULL,
  currency TEXT NOT NULL,
  cabin TEXT NOT NULL,
  dates TEXT NOT NULL,
  tags TEXT NOT NULL
);

CREATE TABLE hotels (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  location TEXT NOT NULL,
  nightly_rate REAL NOT NULL,
  currency TEXT NOT NULL,
  rating REAL NOT NULL,
  amenities TEXT NOT NULL
);

CREATE TABLE trips (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  destination TEXT NOT NULL,
  flight_id TEXT NOT NULL,
  hotel_id TEXT NOT NULL,
  status TEXT NOT NULL,
  total_estimate REAL NOT NULL,
  currency TEXT NOT NULL,
  FOREIGN KEY (flight_id) REFERENCES flights(id),
  FOREIGN KEY (hotel_id) REFERENCES hotels(id)
);

CREATE TABLE bookings (
  id TEXT PRIMARY KEY,
  booking_reference TEXT NOT NULL,
  user_id TEXT NOT NULL,
  username TEXT NOT NULL,
  type TEXT NOT NULL,
  item_id TEXT NOT NULL,
  travelers INTEGER NOT NULL,
  booking_price REAL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE deal_alert_consents (
  id TEXT PRIMARY KEY,
  booking_id TEXT NOT NULL,
  username TEXT NOT NULL,
  route_from TEXT NOT NULL,
  route_to TEXT NOT NULL,
  criteria_json TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (booking_id, username),
  FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE
);

CREATE TRIGGER delete_deal_alert_consents_after_booking_delete
AFTER DELETE ON bookings
FOR EACH ROW
BEGIN
  DELETE FROM deal_alert_consents
  WHERE booking_id = OLD.id;
END;
