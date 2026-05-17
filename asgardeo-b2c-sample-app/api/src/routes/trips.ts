import { listTrips } from "../db.js";
import { sendJson } from "../utils.js";

export function registerTripRoutes(app) {
  app.get("/api/trips", (request, response) => {
    sendJson(response, 200, {
      data: listTrips({
        destination: typeof request.query.destination === "string" ? request.query.destination : null
      })
    });
  });
}
