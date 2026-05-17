import { listLocations } from "../db.js";
import { sendJson } from "../utils.js";

export function registerLocationRoutes(app) {
  app.get("/api/locations", (request, response) => {
    sendJson(response, 200, {
      data: listLocations({
        category: typeof request.query.category === "string" ? request.query.category : null
      })
    });
  });
}
