# HCCNA Backend

This context describes the language of the HCCNA backend: the server-side system that supports app users, church content, attendance workflows, giving views, media, and external church-platform integrations.

## Language

**User**:
A person who can authenticate into the HCCNA app.
_Avoid_: Account, member

**User Profile**:
The backend's saved record about a **User**, including app identity and optional church-platform linkage.
_Avoid_: Profile

**CCB Individual**:
The corresponding person record in Church Community Builder.
_Avoid_: CCB user, member

**CCB Family**:
The household or family grouping in Church Community Builder.
_Avoid_: Household, family account

**CCB Event**:
An event record owned by Church Community Builder.
_Avoid_: Event when the source system matters

**Featured Event**:
A CMS-managed event promoted on the app home page.
_Avoid_: featureEvent, Event when the home-page CMS role matters

**Featured Event Image**:
The image that visually represents a **Featured Event** on the app home page.
_Avoid_: event image when the home-page CMS role matters

**Prominent Colors**:
The ordered dark, light, and accent hex colors derived from a **Featured Event Image**.
_Avoid_: dominant colors, image palette

**Attendance Event**:
An HCCNA-managed attendance workflow based on a **CCB Event**.
_Avoid_: Event

**Attendance Occurrence**:
One dated instance of an **Attendance Event**.
_Avoid_: Attendance date

**Attending Group**:
The group whose people are checked for an **Attendance Event**.
_Avoid_: Group when the attendance role is ambiguous

**CCB Participant**:
A **CCB Individual** connected to a CCB group, regardless of group status.
_Avoid_: CCB member unless member status specifically matters

**Attendance Entry**:
One **CCB Individual**'s attendance state for an **Attendance Occurrence**.
_Avoid_: Attendance record

**Attendance Snapshot**:
The full attendance state for one **Attendance Occurrence** at a point in time.
_Avoid_: Export data

**Giving**:
The user-facing concept of a person's charitable giving history.
_Avoid_: Donations when referring to the whole history

**Donation**:
One financial contribution record within **Giving**.
_Avoid_: Giving item

**Giving Summary**:
An aggregate of **Donations** for a time period.
_Avoid_: Donation summary when the user-facing context is broader giving history

**CCB Transaction**:
The source-system transaction record from Church Community Builder.
_Avoid_: Donation when the source-system record identity matters

**Scripture**:
A Bible verse or passage available for app experiences.
_Avoid_: Verse when the reusable content matters

**Verse of the Day**:
The **Scripture** selected for one calendar day.
_Avoid_: VOD, daily verse

**Word of Activation**:
The monthly **Scripture** associated with a **User**.
_Avoid_: WOA

**Word of Activation Subscription**:
A **User**'s participation in monthly Word of Activation delivery.
_Avoid_: WOA sub

**Integration**:
An external system the backend communicates with.
_Avoid_: Plugin when describing domain capability

**Integration Capability**:
The role an **Integration** provides to the backend.
_Avoid_: Plugin capability

**Integration Manifest**:
Metadata declaring an **Integration**'s capabilities, contract version, telemetry namespace, and optional runtime layer.
_Avoid_: Plugin manifest in domain language

**Campus**:
A physical HCCNA church location (e.g. House of Stars in Union, NJ) where services are held.
_Avoid_: Location, branch, site

**Transport Coordinator**:
A **User** designated for a **Campus** to manage **Transport Requests** and who may drive a **Pickup Run**.
_Avoid_: Designated account, dispatcher, driver (as a standing role)

**Church Event**:
A CMS-managed event on the church calendar shown in the app's events listing, which may explicitly offer transport to one **Campus**.
_Avoid_: Event entry, CMS event, upcoming event

**Event Occurrence**:
One dated instance of a **Church Event** derived from its recurrence.
_Avoid_: Event date, occurrence date when the instance identity matters

**Guest Rider**:
A person without a **User** account for whom a **Transport Coordinator** creates a **Transport Request**.
_Avoid_: Walk-in, phone-in, offline rider

**Transport Request**:
A request, by a **User** or on behalf of a **Guest Rider**, to be picked up and brought to a **Campus** for one **Event Occurrence**.
_Avoid_: Transport appointment, ride request, booking

**Request Cutoff**:
The moment before an **Event Occurrence**'s start after which Users can no longer submit their own **Transport Requests**; **Transport Coordinators** may still add late requests until departure.
_Avoid_: Deadline, closing time

**Pickup Run**:
The ordered set of pickups one **Transport Coordinator** drives to bring accepted **Transport Requests** to a **Campus** for one **Event Occurrence**.
_Avoid_: Trip, route (for the domain concept), ride

**Pickup Stop**:
One **Transport Request**'s place in a **Pickup Run**, with its order and **Scheduled Pickup Time**.
_Avoid_: Waypoint, leg

**Scheduled Pickup Time**:
The time a rider is told to be ready, derived from the **Pickup Run**'s planned route.
_Avoid_: ETA when the promised time matters

## Relationships

- A **User** has at most one **User Profile**
- A **User Profile** may link to at most one **CCB Individual**
- A **CCB Individual** may belong to one **CCB Family**
- A **Featured Event** has one **Featured Event Image**
- A **Featured Event Image** belongs to at most one **Featured Event**
- A **Featured Event Image** may have zero or more **Prominent Colors**
- An **Attendance Event** is based on one **CCB Event**
- An **Attendance Event** has one or more **Attendance Occurrences**
- An **Attendance Event** is checked against one **Attending Group**
- An **Attending Group** provides the **CCB Participants** eligible for the attendance roster
- An **Attendance Occurrence** has one **Attendance Snapshot**
- An **Attendance Snapshot** contains zero or more **Attendance Entries**
- An **Attendance Entry** belongs to one **CCB Individual**
- A **User** may have **Giving**
- **Giving** contains zero or more **Donations**
- A **Giving Summary** aggregates **Donations** for one time period
- A **Donation** may correspond to one **CCB Transaction**
- A **Verse of the Day** references one **Scripture**
- A **Word of Activation** references one **Scripture**
- A **User** may have one **Word of Activation Subscription**
- An **Integration** declares one or more **Integration Capabilities**
- An **Integration Manifest** describes one **Integration**
- A **Campus** may have zero or more **Transport Coordinators**
- A **Church Event** has one or more **Event Occurrences**
- A transport-eligible **Church Event** designates one destination **Campus**
- A **Transport Request** targets one **Event Occurrence** at one **Campus**
- A **Transport Request** is made by one **User** or created for one **Guest Rider**
- An **Event Occurrence** has one **Request Cutoff**
- A **Pickup Run** serves one **Event Occurrence**
- A **Pickup Run** is driven by one **Transport Coordinator**
- A **Pickup Run** has one or more **Pickup Stops**
- A **Pickup Stop** belongs to one **Transport Request** and one **Pickup Run**
- A **Transport Request** may have a **Pickup Stop** on more than one **Pickup Run** (inbound and return)

## Example Dialogue

> **Dev:** "When a **User** signs in, do we require a linked **CCB Individual**?"
> **Domain expert:** "No — the **User** can authenticate before their **User Profile** is linked to a **CCB Individual**."

> **Dev:** "Is this just a **CCB Event**?"
> **Domain expert:** "Not exactly — CCB owns the event, but the HCCNA app manages an **Attendance Event** workflow around that **CCB Event** and its dated **Attendance Occurrences**."

> **Dev:** "Should this home-page event use the same language as attendance?"
> **Domain expert:** "No — call it a **Featured Event** because it is CMS-managed app content, not a **CCB Event** or **Attendance Event**."

> **Dev:** "Are these dominant colors from every event image?"
> **Domain expert:** "Call them **Prominent Colors**, and derive them only from the **Featured Event Image** used for home-page content."

> **Dev:** "Should the profile field show donation history or giving history?"
> **Domain expert:** "Use **Giving** for the user's overall history; each row inside it is a **Donation**."

> **Dev:** "Is VOD the same thing as **Scripture**?"
> **Domain expert:** "No — **Scripture** is reusable verse content, while **Verse of the Day** is the selected **Scripture** for a specific day."

> **Dev:** "Are these backend plugins?"
> **Domain expert:** "Treat them as **Integrations** for now; a manifest describes what each external system provides."

> **Dev:** "Does a rider book a ride to the Sunday service?"
> **Domain expert:** "They submit a **Transport Request** for an **Event Occurrence** before its **Request Cutoff**; a **Transport Coordinator** approves it and later includes it in a **Pickup Run**."

> **Dev:** "Is the driver a separate role?"
> **Domain expert:** "No — the **Transport Coordinator** who drives a **Pickup Run** is that run's driver; driving is per-run, not a standing role."

> **Dev:** "Sister Grace phones the office every week for a ride but has no app. Is she a **User**?"
> **Domain expert:** "No — she is a **Guest Rider**; the **Transport Coordinator** creates her **Transport Request**, and she gets a **Pickup Stop** like everyone else."

> **Dev:** "Is the ETA the pickup time we promised?"
> **Domain expert:** "No — the **Scheduled Pickup Time** is the promise made when the run was planned; the live ETA on pickup day may drift from it."

## Flagged Ambiguities

- "account" should not be used for a person; use **User** for the person and **User Profile** for the saved backend record.
- "member" should not be used unless church membership status becomes an explicit domain concept.
- CCB source terms should be used as the base vocabulary, but HCCNA-owned concepts should be named at the level the system owns; use a `CCB` prefix when the source-system meaning matters.
- "event" is overloaded; use **Featured Event** for CMS-managed home-page content, **CCB Event** for the source record, **Attendance Event** for the HCCNA attendance workflow, and **Church Event** for the app's events-listing calendar entries.
- Attendance rosters are based on **CCB Participants**, not only CCB group members.
- "numberOfGiving" is legacy wording; use **Donation Count** or `numberOfDonations` in new surfaces.
- "VOD" and "WOA" are code shorthands; use **Verse of the Day** and **Word of Activation** in domain language and documentation.
- "plugin" is current implementation wording for integration metadata; use **Integration** and **Integration Manifest** in domain language.
- "designated account" was used for the receiver of transport requests — resolved: that is the **Transport Coordinator**, a designated **User**, not an account.
- "Union" is a colloquial name for the House of Stars **Campus** (Union, NJ); it is not a distinct campus.
