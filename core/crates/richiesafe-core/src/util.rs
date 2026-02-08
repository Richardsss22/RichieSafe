use unicode_normalization::UnicodeNormalization;

pub fn normalize_input(input: &str) -> String {
    input.trim().nfkd().collect::<String>()
}
