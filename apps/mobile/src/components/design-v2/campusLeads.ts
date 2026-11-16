import type { CampusData } from "@/relay/campuses";

/** Every campus lead, or the single campus lead when the list is empty. */
export function campusLeadsOf(campus: CampusData) {
  if (campus.campusLeads?.length) {
    return campus.campusLeads;
  }
  return campus.campusLead ? [campus.campusLead] : [];
}

/** Each cycling card's place in the change sequence; cards with one named lead don't cycle. */
export function leadCycleOrders(campuses: readonly CampusData[]) {
  const cycling = campuses.filter(
    (campus) => campusLeadsOf(campus).filter((lead) => lead.name).length > 1,
  );
  return new Map(cycling.map((campus, order) => [campus.slug, order]));
}
