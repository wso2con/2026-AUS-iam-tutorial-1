import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  cancelBooking,
  createBooking,
  getBookedFlights,
  getFlight,
  getFlights,
  getHotels,
  getLocations,
  getProfile,
  getTrips,
  updateProfile
} from "./api";

export const apiQueryKeys = {
  bookedFlightsRoot: ["api", "bookings", "flights"],
  bookedFlights: () => ["api", "bookings", "flights"],
  flight: (flightId) => ["api", "flights", flightId],
  flights: (searchParams = {}) => ["api", "flights", searchParams],
  hotels: (searchParams = {}) => ["api", "hotels", searchParams],
  locations: (category) => ["api", "locations", category],
  profile: () => ["api", "profile"],
  trips: (searchParams = {}) => ["api", "trips", searchParams]
};

export function useLocationQuery(category, options = {}) {
  return useQuery({
    queryKey: apiQueryKeys.locations(category),
    queryFn: () => getLocations({ category }),
    enabled: Boolean(category) && (options.enabled ?? true),
    staleTime: 5 * 60_000
  });
}

export function useFlightQuery(flightId, options = {}) {
  return useQuery({
    queryKey: apiQueryKeys.flight(flightId),
    queryFn: () => getFlight(flightId),
    enabled: Boolean(flightId) && (options.enabled ?? true)
  });
}

export function useSearchResultsQuery(criteria, options = {}) {
  const category = criteria.category || "flights";
  const searchParams = category === "flights"
    ? { from: criteria.from, to: criteria.to }
    : category === "hotels"
      ? { location: criteria.to }
      : { destination: criteria.to };

  return useQuery({
    queryKey: category === "flights"
      ? apiQueryKeys.flights(searchParams)
      : category === "hotels"
        ? apiQueryKeys.hotels(searchParams)
        : apiQueryKeys.trips(searchParams),
    queryFn: () => {
      if (category === "hotels") {
        return getHotels(searchParams);
      }

      if (category === "trips") {
        return getTrips(searchParams);
      }

      return getFlights(searchParams);
    },
    enabled: options.enabled ?? true
  });
}

export function useBookedFlightsQuery(options = {}) {
  return useQuery({
    queryKey: apiQueryKeys.bookedFlights(),
    queryFn: () => getBookedFlights(),
    enabled: options.enabled ?? true,
    refetchOnMount: "always"
  });
}

export function useProfileQuery(options = {}) {
  return useQuery({
    queryKey: apiQueryKeys.profile(),
    queryFn: () => getProfile(),
    enabled: options.enabled ?? true
  });
}

export function useCreateBookingMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (booking) => createBooking(booking),
    onSuccess: () => {
      return queryClient.invalidateQueries({ queryKey: apiQueryKeys.bookedFlightsRoot });
    }
  });
}

export function useCancelBookingMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (bookingId) => cancelBooking(bookingId),
    onSuccess: () => {
      return queryClient.invalidateQueries({ queryKey: apiQueryKeys.bookedFlightsRoot });
    }
  });
}

export function useUpdateProfileMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (profile) => updateProfile(profile),
    onSuccess: (profile) => {
      queryClient.setQueryData(apiQueryKeys.profile(), profile);
    }
  });
}
