import { useAsgardeo } from "@asgardeo/react";
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
  bookedFlights: (userKey = "anonymous") => ["api", "bookings", "flights", userKey],
  flight: (flightId, userKey = "anonymous") => ["api", "flights", flightId, userKey],
  flights: (searchParams = {}, userKey = "anonymous") => ["api", "flights", searchParams, userKey],
  hotels: (searchParams = {}, userKey = "anonymous") => ["api", "hotels", searchParams, userKey],
  locations: (category, userKey = "anonymous") => ["api", "locations", category, userKey],
  profile: (userKey = "anonymous") => ["api", "profile", userKey],
  trips: (searchParams = {}, userKey = "anonymous") => ["api", "trips", searchParams, userKey]
};

export function getUserKey(user) {
  return user?.sub || user?.id || user?.username || user?.userName || user?.email || "anonymous";
}

export function useApiAuth() {
  const { getAccessToken, isLoading, isSignedIn, user } = useAsgardeo();

  return {
    getAccessToken,
    isLoading,
    isSignedIn,
    user,
    userKey: getUserKey(user)
  };
}

export function useLocationQuery(category, options = {}) {
  const auth = options.auth;
  const isAuthLoading = auth?.isLoading ?? false;
  const userKey = auth?.isSignedIn ? auth.userKey : "anonymous";

  return useQuery({
    queryKey: apiQueryKeys.locations(category, userKey),
    queryFn: () => getLocations({ category }, auth),
    enabled: Boolean(category) && !isAuthLoading && (options.enabled ?? true),
    staleTime: 5 * 60_000
  });
}

export function useFlightQuery(flightId, options = {}) {
  const auth = options.auth;
  const isAuthLoading = auth?.isLoading ?? false;
  const userKey = auth?.isSignedIn ? auth.userKey : "anonymous";

  return useQuery({
    queryKey: apiQueryKeys.flight(flightId, userKey),
    queryFn: () => getFlight(flightId, auth),
    enabled: Boolean(flightId) && !isAuthLoading && (options.enabled ?? true)
  });
}

export function useSearchResultsQuery(criteria, options = {}) {
  const auth = options.auth;
  const isAuthLoading = auth?.isLoading ?? false;
  const category = criteria.category || "flights";
  const userKey = auth?.isSignedIn ? auth.userKey : "anonymous";
  const searchParams = category === "flights"
    ? { from: criteria.from, to: criteria.to }
    : category === "hotels"
      ? { location: criteria.to }
      : { destination: criteria.to };

  return useQuery({
    queryKey: category === "flights"
      ? apiQueryKeys.flights(searchParams, userKey)
      : category === "hotels"
        ? apiQueryKeys.hotels(searchParams, userKey)
        : apiQueryKeys.trips(searchParams, userKey),
    queryFn: () => {
      if (category === "hotels") {
        return getHotels(searchParams, auth);
      }

      if (category === "trips") {
        return getTrips(searchParams, auth);
      }

      return getFlights(searchParams, auth);
    },
    enabled: !isAuthLoading && (options.enabled ?? true)
  });
}

export function useBookedFlightsQuery(options = {}) {
  const auth = options.auth;
  const userKey = auth?.userKey || "anonymous";

  return useQuery({
    queryKey: apiQueryKeys.bookedFlights(userKey),
    queryFn: () => getBookedFlights(auth),
    enabled: Boolean(auth?.isSignedIn) && !auth?.isLoading && (options.enabled ?? true),
    refetchOnMount: "always"
  });
}

export function useProfileQuery(options = {}) {
  const auth = options.auth;
  const userKey = auth?.userKey || "anonymous";

  return useQuery({
    queryKey: apiQueryKeys.profile(userKey),
    queryFn: () => getProfile(auth),
    enabled: Boolean(auth?.isSignedIn) && !auth?.isLoading && (options.enabled ?? true)
  });
}

export function useCreateBookingMutation(auth) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (booking) => createBooking(booking, auth),
    onSuccess: () => {
      return queryClient.invalidateQueries({ queryKey: apiQueryKeys.bookedFlightsRoot });
    }
  });
}

export function useCancelBookingMutation(auth) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (bookingId) => cancelBooking(bookingId, auth),
    onSuccess: () => {
      return queryClient.invalidateQueries({ queryKey: apiQueryKeys.bookedFlightsRoot });
    }
  });
}

export function useUpdateProfileMutation(auth) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (profile) => updateProfile(profile, auth),
    onSuccess: (profile) => {
      queryClient.setQueryData(apiQueryKeys.profile(auth?.userKey), profile);
    }
  });
}
