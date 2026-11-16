//! Client metadata from the mobile app's `x-hccna-*` headers, normalized the way
//! `getClientTelemetryMetadata` in `apps/server/src/platform/observability/request.ts` does.

use http::HeaderMap;
use serde::Serialize;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientMetadata {
    pub app_version: String,
    pub app_build: String,
    pub device_type: String,
    pub device_model: String,
    pub os_name: String,
    pub os_version: String,
}

impl ClientMetadata {
    pub fn from_headers(headers: &HeaderMap) -> Self {
        let user_agent = header(headers, &["user-agent"]);
        Self {
            app_version: normalize(header(headers, &["x-hccna-app-version", "x-app-version"])),
            app_build: normalize(header(headers, &["x-hccna-app-build", "x-app-build"])),
            device_type: normalize(Some(
                header(headers, &["x-hccna-device-type", "x-device-type"])
                    .unwrap_or_else(|| infer_device_type(user_agent)),
            )),
            device_model: normalize(header(headers, &["x-hccna-device-model", "x-device-model"])),
            os_name: normalize(Some(
                header(
                    headers,
                    &[
                        "x-hccna-os-name",
                        "x-hccna-platform",
                        "x-os-name",
                        "x-platform",
                    ],
                )
                .unwrap_or_else(|| infer_os_name(user_agent)),
            )),
            os_version: normalize(header(headers, &["x-hccna-os-version", "x-os-version"])),
        }
    }
}

/// The first non-empty header among `names`.
fn header<'a>(headers: &'a HeaderMap, names: &[&str]) -> Option<&'a str> {
    names.iter().find_map(|name| {
        headers
            .get(*name)
            .and_then(|value| value.to_str().ok())
            .filter(|value| !value.is_empty())
    })
}

/// Trims, drops control characters, caps at 80 characters, and maps empty to `unknown`.
fn normalize(value: Option<&str>) -> String {
    let normalized: String = value
        .unwrap_or_default()
        .trim()
        .chars()
        .filter(|c| (*c as u32) >= 32 && (*c as u32) != 127)
        .take(80)
        .collect();
    if normalized.is_empty() {
        "unknown".to_owned()
    } else {
        normalized
    }
}

fn infer_os_name(user_agent: Option<&str>) -> &'static str {
    let Some(ua) = user_agent.map(str::to_ascii_lowercase) else {
        return "unknown";
    };
    if ua.contains("android") {
        "Android"
    } else if ["iphone", "ipad", "ios"].iter().any(|s| ua.contains(s)) {
        "iOS"
    } else if ua.contains("windows") {
        "Windows"
    } else if ua.contains("mac os") || ua.contains("macintosh") {
        "macOS"
    } else if ua.contains("linux") {
        "Linux"
    } else {
        "unknown"
    }
}

fn infer_device_type(user_agent: Option<&str>) -> &'static str {
    let Some(ua) = user_agent.map(str::to_ascii_lowercase) else {
        return "unknown";
    };
    if ua.contains("ipad") || ua.contains("tablet") {
        "tablet"
    } else if ua.contains("iphone") || ua.contains("mobile") {
        // `mobile` also covers the TS pattern `android.*mobile`.
        "phone"
    } else {
        "desktop"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use http::HeaderValue;

    fn headers(pairs: &[(&'static str, &str)]) -> HeaderMap {
        let mut map = HeaderMap::new();
        for (name, value) in pairs {
            map.insert(*name, HeaderValue::from_str(value).unwrap());
        }
        map
    }

    #[test]
    fn reads_app_headers() {
        let meta = ClientMetadata::from_headers(&headers(&[
            ("x-hccna-app-version", " 2.1.0 "),
            ("x-hccna-app-build", "42"),
            ("x-hccna-device-type", "phone"),
            ("x-hccna-device-model", "Example Phone"),
            ("x-hccna-os-name", "iOS"),
            ("x-hccna-os-version", "18.0"),
        ]));
        assert_eq!(meta.app_version, "2.1.0");
        assert_eq!(meta.app_build, "42");
        assert_eq!(meta.device_type, "phone");
        assert_eq!(meta.device_model, "Example Phone");
        assert_eq!(meta.os_name, "iOS");
        assert_eq!(meta.os_version, "18.0");
    }

    #[test]
    fn falls_back_to_alternate_headers_and_user_agent() {
        let meta = ClientMetadata::from_headers(&headers(&[
            ("x-app-version", "1.0.0"),
            ("x-platform", "android"),
            (
                "user-agent",
                "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)",
            ),
        ]));
        assert_eq!(meta.app_version, "1.0.0");
        assert_eq!(meta.os_name, "android");
        assert_eq!(meta.device_type, "tablet");
        assert_eq!(meta.app_build, "unknown");
    }

    #[test]
    fn infers_from_user_agent_alone() {
        let meta = ClientMetadata::from_headers(&headers(&[(
            "user-agent",
            "Mozilla/5.0 (Linux; Android 15; Example) Mobile Safari/537.36",
        )]));
        assert_eq!(meta.os_name, "Android");
        assert_eq!(meta.device_type, "phone");
        let desktop = ClientMetadata::from_headers(&headers(&[("user-agent", "k6/1.5.0")]));
        assert_eq!(desktop.os_name, "unknown");
        assert_eq!(desktop.device_type, "desktop");
        let none = ClientMetadata::from_headers(&HeaderMap::new());
        assert_eq!(none.device_type, "unknown");
    }

    #[test]
    fn normalizes_values() {
        assert_eq!(normalize(Some("   ")), "unknown");
        assert_eq!(normalize(Some("a\u{7f}b\tc")), "abc");
        assert_eq!(normalize(Some(&"x".repeat(100))).len(), 80);
    }
}
