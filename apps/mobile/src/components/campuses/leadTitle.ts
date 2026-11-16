/** The CMS LeadershipGroup names a group of leaders; one lead's title is its singular form. */
export const leadTitle = (group: string | null | undefined) => {
  switch (group) {
    case "Regional Pastors": {
      return "Regional Pastor";
    }
    case "Lead Pastors/Campus Leads": {
      return "Lead Pastor";
    }
    case "Ministers": {
      return "Minister";
    }
    case "HODs": {
      return "HOD";
    }
    case "Decons": {
      return "Deacon";
    }
    default: {
      // A group added in the CMS after this build: show it as written.
      const written = group?.trim();
      return written === "" ? undefined : written;
    }
  }
};
