//! The five CCB v1 read services this crate ports: their `srv` names (`CCBServiceNames` in
//! `packages/ccb/src/url.ts`), the query strings `buildCCBUrl` builds for them, and their cache
//! windows (`DefaultCCBCacheConfig` in `packages/ccb/src/cache-config.ts`).

use std::time::Duration;

/// The read side of `CCBRequestType`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Service {
    IndividualSearch,
    IndividualGroups,
    GroupParticipants,
    AttendanceProfile,
    TransactionsByFamily,
}

impl Service {
    /// The `srv` parameter, which is also the `action` metric label (`extractAction` in
    /// `CCBService.ts`).
    pub fn srv(self) -> &'static str {
        match self {
            Self::IndividualSearch => "individual_search",
            Self::IndividualGroups => "individual_groups",
            Self::GroupParticipants => "group_participants",
            Self::AttendanceProfile => "attendance_profile",
            Self::TransactionsByFamily => "transactions_by_family",
        }
    }

    /// How long an answer is fresh (`ttl`), and how much longer it may be served while one
    /// background refresh runs (`swr`).
    pub fn cache_policy(self) -> CachePolicy {
        let (ttl, swr) = match self {
            Self::IndividualSearch => (minutes(20), minutes(30)),
            Self::GroupParticipants => (minutes(15), minutes(30)),
            Self::IndividualGroups => (minutes(25), minutes(50)),
            Self::TransactionsByFamily => (hours(40), hours(80)),
            Self::AttendanceProfile => (Duration::from_secs(5), Duration::from_secs(10)),
        };
        CachePolicy { ttl, swr }
    }
}

const fn minutes(count: u64) -> Duration {
    Duration::from_secs(count * 60)
}

const fn hours(count: u64) -> Duration {
    Duration::from_secs(count * 60 * 60)
}

/// `CCBCacheConfig`: fresh for `ttl`, then stale but servable for `swr` more.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CachePolicy {
    pub ttl: Duration,
    pub swr: Duration,
}

/// One GET: its service and the query string after `?`, which also keys the cache.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CcbRequest {
    service: Service,
    query: String,
}

impl CcbRequest {
    /// `srv=individual_search&email=<encodeURIComponent(email)>`.
    pub fn individual_search(email: &str) -> Self {
        Self::new(
            Service::IndividualSearch,
            &format!("email={}", encode_uri_component(email)),
        )
    }

    /// `srv=individual_groups&individual_id=<id>`.
    pub fn individual_groups(individual_id: u64) -> Self {
        Self::new(
            Service::IndividualGroups,
            &format!("individual_id={individual_id}"),
        )
    }

    /// `srv=group_participants&id=<group id>`.
    pub fn group_participants(group_id: u64) -> Self {
        Self::new(Service::GroupParticipants, &format!("id={group_id}"))
    }

    /// `srv=attendance_profile&id=<event id>&occurrence=<occurrence>`, the occurrence inserted as
    /// given.
    pub fn attendance_profile(event_id: u64, occurrence: &str) -> Self {
        Self::new(
            Service::AttendanceProfile,
            &format!("id={event_id}&occurrence={occurrence}"),
        )
    }

    /// `srv=transactions_by_family&family_id=<id>&modified_since=<year - 1>-12-31&date_end=<year>-12-31`,
    /// the family id inserted as given. TS defaults `year` to `new Date().getFullYear()`; callers
    /// pass it.
    pub fn transactions_by_family(family_id: &str, year: i32) -> Self {
        Self::new(
            Service::TransactionsByFamily,
            &format!(
                "family_id={family_id}&modified_since={}-12-31&date_end={year}-12-31",
                year - 1
            ),
        )
    }

    fn new(service: Service, params: &str) -> Self {
        Self {
            service,
            query: format!("srv={}&{params}", service.srv()),
        }
    }

    pub fn service(&self) -> Service {
        self.service
    }

    pub fn query(&self) -> &str {
        &self.query
    }
}

/// JavaScript's `encodeURIComponent`: every UTF-8 byte outside `A–Z a–z 0–9 - _ . ! ~ * ' ( )`
/// becomes `%XX`.
pub fn encode_uri_component(value: &str) -> String {
    value
        .bytes()
        .map(|byte| match byte {
            b'A'..=b'Z'
            | b'a'..=b'z'
            | b'0'..=b'9'
            | b'-'
            | b'_'
            | b'.'
            | b'!'
            | b'~'
            | b'*'
            | b'\''
            | b'('
            | b')' => char::from(byte).to_string(),
            _ => format!("%{byte:02X}"),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_the_query_strings_of_build_ccb_url() {
        let queries = [
            CcbRequest::individual_search("ada@example.com"),
            CcbRequest::individual_groups(1001),
            CcbRequest::group_participants(3001),
            CcbRequest::attendance_profile(4001, "2026-10-04"),
            CcbRequest::transactions_by_family("2001", 2026),
        ]
        .map(|request| request.query().to_owned());
        assert_eq!(
            queries,
            [
                "srv=individual_search&email=ada%40example.com",
                "srv=individual_groups&individual_id=1001",
                "srv=group_participants&id=3001",
                "srv=attendance_profile&id=4001&occurrence=2026-10-04",
                "srv=transactions_by_family&family_id=2001&modified_since=2025-12-31&date_end=2026-12-31",
            ]
        );
    }

    #[test]
    fn encodes_like_encode_uri_component() {
        // `encodeURIComponent("ada+o'neil (x)@example.com !*~_.-é ")` in Node.
        assert_eq!(
            encode_uri_component("ada+o'neil (x)@example.com !*~_.-é "),
            "ada%2Bo'neil%20(x)%40example.com%20!*~_.-%C3%A9%20"
        );
    }

    #[test]
    fn names_each_service_and_its_request() {
        assert_eq!(
            CcbRequest::individual_search("ada@example.com").service(),
            Service::IndividualSearch
        );
        assert_eq!(
            CcbRequest::transactions_by_family("2001", 2026).service(),
            Service::TransactionsByFamily
        );
    }

    #[test]
    fn uses_the_windows_of_cache_config() {
        let windows = [
            Service::IndividualSearch,
            Service::GroupParticipants,
            Service::IndividualGroups,
            Service::TransactionsByFamily,
            Service::AttendanceProfile,
        ]
        .map(|service| {
            let policy = service.cache_policy();
            (policy.ttl.as_secs(), policy.swr.as_secs())
        });
        assert_eq!(
            windows,
            [
                (20 * 60, 30 * 60),
                (15 * 60, 30 * 60),
                (25 * 60, 50 * 60),
                (40 * 60 * 60, 80 * 60 * 60),
                (5, 10),
            ]
        );
    }
}
