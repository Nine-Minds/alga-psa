//! PII detection patterns
//!
//! Contains regex patterns for detecting various types of PII.
//! These patterns match the TypeScript implementation in piiDetection.ts
//!
//! Note: Rust's regex crate doesn't support lookahead/lookbehind assertions,
//! so patterns are simplified and additional validation is done in code.

use once_cell::sync::Lazy;
use regex::Regex;

/// PII type enumeration
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum PiiType {
    Ssn,
    CreditCard,
    BankAccount,
    DateOfBirth,
    DriversLicense,
    Passport,
    Email,
    Phone,
    Ipv4,
    Ipv6,
    MacAddress,
    Name,
    Address,
}

impl PiiType {
    /// Get the string identifier for this PII type
    pub fn as_str(&self) -> &'static str {
        match self {
            PiiType::Ssn => "ssn",
            PiiType::CreditCard => "credit_card",
            PiiType::BankAccount => "bank_account",
            PiiType::DateOfBirth => "date_of_birth",
            PiiType::DriversLicense => "drivers_license",
            PiiType::Passport => "passport",
            PiiType::Email => "email",
            PiiType::Phone => "phone",
            PiiType::Ipv4 => "ipv4",
            PiiType::Ipv6 => "ipv6",
            PiiType::MacAddress => "mac_address",
            PiiType::Name => "name",
            PiiType::Address => "address",
        }
    }

    /// Get severity level
    pub fn severity(&self) -> &'static str {
        match self {
            PiiType::Ssn | PiiType::CreditCard | PiiType::BankAccount | PiiType::Passport => "high",
            PiiType::DateOfBirth | PiiType::DriversLicense => "medium",
            _ => "low",
        }
    }

    /// Parse from string
    pub fn from_str(s: &str) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "ssn" | "social_security" => Some(PiiType::Ssn),
            "credit_card" | "creditcard" => Some(PiiType::CreditCard),
            "bank_account" | "bankaccount" => Some(PiiType::BankAccount),
            "date_of_birth" | "dob" | "dateofbirth" => Some(PiiType::DateOfBirth),
            "drivers_license" | "driverslicense" => Some(PiiType::DriversLicense),
            "passport" => Some(PiiType::Passport),
            "email" => Some(PiiType::Email),
            "phone" => Some(PiiType::Phone),
            "ipv4" | "ip_v4" => Some(PiiType::Ipv4),
            "ipv6" | "ip_v6" => Some(PiiType::Ipv6),
            "mac_address" | "macaddress" => Some(PiiType::MacAddress),
            "name" => Some(PiiType::Name),
            "address" => Some(PiiType::Address),
            _ => None,
        }
    }
}

/// A PII match result
#[derive(Debug, Clone)]
pub struct PiiMatch {
    pub pii_type: PiiType,
    pub start: usize,
    pub end: usize,
    pub line: u32,
    pub column: u32,
    pub confidence: f32,
}

// Compiled regex patterns (lazy static for efficiency)
// Note: Patterns are simplified to avoid lookahead/lookbehind which Rust regex doesn't support

/// SSN pattern: XXX-XX-XXXX or XXXXXXXXX
/// Additional validation is done in code to check for invalid prefixes
static SSN_PATTERN: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"\b([0-8]\d{2})-?(\d{2})-?(\d{4})\b").unwrap()
});

/// Credit card patterns - simplified without lookbehind/ahead
static VISA_PATTERN: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"\b4\d{3}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b").unwrap()
});

static MASTERCARD_PATTERN: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"\b5[1-5]\d{2}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b").unwrap()
});

static AMEX_PATTERN: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"\b3[47]\d{2}[\s-]?\d{6}[\s-]?\d{5}\b").unwrap()
});

static DISCOVER_PATTERN: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"\b(6011|65\d{2})[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b").unwrap()
});

/// Bank account pattern (with context)
static BANK_ACCOUNT_PATTERN: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)(routing|account|acct)[\s#:]*(\d{9}[\s-]?\d{4,17})").unwrap()
});

/// Date of birth patterns
static DOB_PATTERN_US: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"\b(0[1-9]|1[0-2])[-/](0[1-9]|[12]\d|3[01])[-/](19|20)\d{2}\b").unwrap()
});

static DOB_PATTERN_ISO: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"\b(19|20)\d{2}[-/](0[1-9]|1[0-2])[-/](0[1-9]|[12]\d|3[01])\b").unwrap()
});

/// Driver's license patterns by state
static DL_CA_PATTERN: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)(?:d\.?l\.?|license|lic)[\s#:]*([A-Z]\d{7})\b").unwrap()
});

static DL_NY_PATTERN: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)(?:d\.?l\.?|license|lic)[\s#:]*(\d{9})\b").unwrap()
});

static DL_TX_PATTERN: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)(?:d\.?l\.?|license|lic)[\s#:]*(\d{7,8})\b").unwrap()
});

/// Passport pattern (with context)
static PASSPORT_PATTERN: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)(passport)[\s#:]*([A-Z0-9]{6,9})").unwrap()
});

/// Email pattern
static EMAIL_PATTERN: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}").unwrap()
});

/// Phone patterns - simplified
static PHONE_US_PATTERN: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b").unwrap()
});

static PHONE_INTL_PATTERN: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"\+[1-9]\d{1,14}").unwrap()
});

/// IP address patterns - simplified
static IPV4_PATTERN: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"\b(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\b").unwrap()
});

static IPV6_PATTERN: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}").unwrap()
});

/// MAC address pattern
static MAC_PATTERN: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}").unwrap()
});

/// Detect PII in text
pub fn detect_pii(text: &str, types: &[PiiType]) -> Vec<PiiMatch> {
    let mut matches = Vec::new();

    for pii_type in types {
        let type_matches = match pii_type {
            PiiType::Ssn => detect_ssn(text),
            PiiType::CreditCard => detect_credit_card(text),
            PiiType::BankAccount => detect_bank_account(text),
            PiiType::DateOfBirth => detect_dob(text),
            PiiType::DriversLicense => detect_drivers_license(text),
            PiiType::Passport => detect_passport(text),
            PiiType::Email => detect_email(text),
            PiiType::Phone => detect_phone(text),
            PiiType::Ipv4 => detect_ipv4(text),
            PiiType::Ipv6 => detect_ipv6(text),
            PiiType::MacAddress => detect_mac_address(text),
            PiiType::Name | PiiType::Address => vec![], // Requires NER, not implemented in WASM
        };
        matches.extend(type_matches);
    }

    matches
}

fn detect_ssn(text: &str) -> Vec<PiiMatch> {
    SSN_PATTERN
        .captures_iter(text)
        .filter_map(|cap| {
            let m = cap.get(0)?;
            let area = cap.get(1)?.as_str();
            let group = cap.get(2)?.as_str();
            let serial = cap.get(3)?.as_str();

            // Validate SSN: area cannot be 000, 666, or 900-999
            // Group cannot be 00, serial cannot be 0000
            let area_num: u16 = area.parse().ok()?;
            let group_num: u16 = group.parse().ok()?;
            let serial_num: u16 = serial.parse().ok()?;

            if area_num == 0 || area_num == 666 || area_num >= 900 {
                return None;
            }
            if group_num == 0 {
                return None;
            }
            if serial_num == 0 {
                return None;
            }

            Some(create_match(PiiType::Ssn, text, m.start(), m.end(), 0.95))
        })
        .collect()
}

fn detect_credit_card(text: &str) -> Vec<PiiMatch> {
    let mut matches = Vec::new();

    // Check each card pattern and verify with Luhn
    for pattern in [
        &*VISA_PATTERN,
        &*MASTERCARD_PATTERN,
        &*AMEX_PATTERN,
        &*DISCOVER_PATTERN,
    ] {
        for m in pattern.find_iter(text) {
            let card_str = m.as_str();
            let digits: String = card_str.chars().filter(|c| c.is_ascii_digit()).collect();

            if luhn_check(&digits) {
                matches.push(create_match(PiiType::CreditCard, text, m.start(), m.end(), 0.98));
            }
        }
    }

    matches
}

fn detect_bank_account(text: &str) -> Vec<PiiMatch> {
    BANK_ACCOUNT_PATTERN
        .find_iter(text)
        .map(|m| create_match(PiiType::BankAccount, text, m.start(), m.end(), 0.85))
        .collect()
}

fn detect_dob(text: &str) -> Vec<PiiMatch> {
    let mut matches: Vec<PiiMatch> = DOB_PATTERN_US
        .find_iter(text)
        .map(|m| create_match(PiiType::DateOfBirth, text, m.start(), m.end(), 0.80))
        .collect();

    matches.extend(
        DOB_PATTERN_ISO
            .find_iter(text)
            .map(|m| create_match(PiiType::DateOfBirth, text, m.start(), m.end(), 0.80)),
    );

    matches
}

fn detect_drivers_license(text: &str) -> Vec<PiiMatch> {
    let mut matches = Vec::new();

    for pattern in [&*DL_CA_PATTERN, &*DL_NY_PATTERN, &*DL_TX_PATTERN] {
        matches.extend(
            pattern
                .find_iter(text)
                .map(|m| create_match(PiiType::DriversLicense, text, m.start(), m.end(), 0.75)),
        );
    }

    matches
}

fn detect_passport(text: &str) -> Vec<PiiMatch> {
    PASSPORT_PATTERN
        .find_iter(text)
        .map(|m| create_match(PiiType::Passport, text, m.start(), m.end(), 0.85))
        .collect()
}

fn detect_email(text: &str) -> Vec<PiiMatch> {
    EMAIL_PATTERN
        .find_iter(text)
        .map(|m| create_match(PiiType::Email, text, m.start(), m.end(), 0.99))
        .collect()
}

fn detect_phone(text: &str) -> Vec<PiiMatch> {
    let mut matches: Vec<PiiMatch> = PHONE_US_PATTERN
        .find_iter(text)
        .map(|m| create_match(PiiType::Phone, text, m.start(), m.end(), 0.90))
        .collect();

    matches.extend(
        PHONE_INTL_PATTERN
            .find_iter(text)
            .map(|m| create_match(PiiType::Phone, text, m.start(), m.end(), 0.95)),
    );

    matches
}

fn detect_ipv4(text: &str) -> Vec<PiiMatch> {
    IPV4_PATTERN
        .captures_iter(text)
        .filter_map(|cap| {
            let m = cap.get(0)?;

            // Validate each octet is 0-255
            for i in 1..=4 {
                let octet: u16 = cap.get(i)?.as_str().parse().ok()?;
                if octet > 255 {
                    return None;
                }
            }

            Some(create_match(PiiType::Ipv4, text, m.start(), m.end(), 0.99))
        })
        .collect()
}

fn detect_ipv6(text: &str) -> Vec<PiiMatch> {
    IPV6_PATTERN
        .find_iter(text)
        .map(|m| create_match(PiiType::Ipv6, text, m.start(), m.end(), 0.99))
        .collect()
}

fn detect_mac_address(text: &str) -> Vec<PiiMatch> {
    MAC_PATTERN
        .find_iter(text)
        .map(|m| create_match(PiiType::MacAddress, text, m.start(), m.end(), 0.99))
        .collect()
}

/// Create a PiiMatch with line/column calculation
fn create_match(pii_type: PiiType, text: &str, start: usize, end: usize, confidence: f32) -> PiiMatch {
    // Calculate line and column
    let prefix = &text[..start];
    let line = prefix.chars().filter(|&c| c == '\n').count() as u32 + 1;
    let last_newline = prefix.rfind('\n').map(|i| i + 1).unwrap_or(0);
    let column = (start - last_newline) as u32 + 1;

    PiiMatch {
        pii_type,
        start,
        end,
        line,
        column,
        confidence,
    }
}

/// Luhn algorithm for credit card validation
fn luhn_check(digits: &str) -> bool {
    if digits.len() < 13 || digits.len() > 19 {
        return false;
    }

    let mut sum = 0;
    let mut double = false;

    for c in digits.chars().rev() {
        if let Some(d) = c.to_digit(10) {
            let mut d = d;
            if double {
                d *= 2;
                if d > 9 {
                    d -= 9;
                }
            }
            sum += d;
            double = !double;
        } else {
            return false;
        }
    }

    sum % 10 == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ssn_detection() {
        let text = "SSN: 123-45-6789";
        let matches = detect_ssn(text);
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].pii_type, PiiType::Ssn);
    }

    #[test]
    fn test_ssn_rejects_invalid() {
        // 000 prefix is invalid
        let text = "SSN: 000-45-6789";
        let matches = detect_ssn(text);
        assert_eq!(matches.len(), 0);

        // 666 prefix is invalid
        let text = "SSN: 666-45-6789";
        let matches = detect_ssn(text);
        assert_eq!(matches.len(), 0);
    }

    #[test]
    fn test_credit_card_visa() {
        let text = "Card: 4111-1111-1111-1111"; // Valid test Visa
        let matches = detect_credit_card(text);
        assert_eq!(matches.len(), 1);
    }

    #[test]
    fn test_credit_card_luhn_invalid() {
        let text = "Card: 4111-1111-1111-1112"; // Invalid checksum
        let matches = detect_credit_card(text);
        assert_eq!(matches.len(), 0);
    }

    #[test]
    fn test_email_detection() {
        let text = "Contact: test@example.com";
        let matches = detect_email(text);
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].pii_type, PiiType::Email);
    }

    #[test]
    fn test_phone_us() {
        let text = "Call: (555) 123-4567";
        let matches = detect_phone(text);
        assert_eq!(matches.len(), 1);
    }

    #[test]
    fn test_ipv4_detection() {
        let text = "Server: 192.168.1.1";
        let matches = detect_ipv4(text);
        assert_eq!(matches.len(), 1);
    }

    #[test]
    fn test_ipv4_rejects_invalid() {
        let text = "Not IP: 999.168.1.1";
        let matches = detect_ipv4(text);
        assert_eq!(matches.len(), 0);
    }

    #[test]
    fn test_luhn_valid() {
        assert!(luhn_check("4111111111111111")); // Test Visa
        assert!(luhn_check("5500000000000004")); // Test Mastercard
    }

    #[test]
    fn test_luhn_invalid() {
        assert!(!luhn_check("4111111111111112"));
        assert!(!luhn_check("1234567890123456"));
    }

    #[test]
    fn test_line_column_calculation() {
        let text = "Line 1\nLine 2: test@example.com\nLine 3";
        let matches = detect_email(text);
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].line, 2);
        assert!(matches[0].column > 0);
    }
}
