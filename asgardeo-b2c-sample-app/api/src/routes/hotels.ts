import { getSearchParams, searchHotels, sendJson } from "../utils.js";

export function registerHotelRoutes(app) {
  app.get("/api/hotels", (request, response) => {
    sendJson(response, 200, {
      data: searchHotels(getSearchParams(request))
    });
  });
}
