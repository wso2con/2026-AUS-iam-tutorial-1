export const flights = [
  {
    id: "wf-101",
    airline: "Skyline Air",
    from: "New York",
    to: "Los Angeles",
    departureTime: "08:10",
    arrivalTime: "11:25",
    duration: "6h 15m",
    dates: "Jun 12 - Jun 18",
    stops: 0,
    cabin: "Economy",
    currency: "USD",
    price: 268,
    tags: ["Flexible", "Lowest fare"]
  },
  {
    id: "wf-202",
    airline: "Pacific Jet",
    from: "Los Angeles",
    to: "Tokyo",
    departureTime: "13:45",
    arrivalTime: "17:20",
    duration: "11h 35m",
    dates: "Jul 02 - Jul 12",
    stops: 1,
    cabin: "Premium Economy",
    currency: "USD",
    price: 914,
    tags: ["Meal included"]
  }
];

export const initialBooking = {
  id: "booking-e2e-existing",
  bookingReference: "E2E202",
  flight: flights[1],
  travelers: 2,
  status: "confirmed",
  createdAt: "2026-05-01T10:00:00.000Z"
};

export const locations = {
  flights: [
    { name: "New York", type: "city" },
    { name: "Los Angeles", type: "city" },
    { name: "Tokyo", type: "city" }
  ],
  hotels: [
    { name: "Los Angeles Marina", type: "area" },
    { name: "Tokyo Shibuya", type: "area" }
  ],
  trips: [
    { name: "Los Angeles", type: "destination" },
    { name: "Tokyo", type: "destination" }
  ]
};
