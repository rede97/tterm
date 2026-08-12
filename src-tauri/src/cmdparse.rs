pub(crate) fn expand_env_str(s: &str) -> String {
    let mut out = String::new();
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '%' {
            let mut var = String::new();
            for next in chars.by_ref() {
                if next == '%' {
                    break;
                }
                var.push(next);
            }
            match std::env::var(&var) {
                Ok(v) => out.push_str(&v),
                Err(_) => {
                    out.push('%');
                    out.push_str(&var);
                    out.push('%');
                }
            }
        } else {
            out.push(c);
        }
    }
    out
}

pub(crate) fn parse_command(cmd_str: &str) -> (String, Vec<String>) {
    let mut tokens: Vec<String> = Vec::new();
    let mut cur = String::new();
    let mut in_quote = false;
    for c in cmd_str.chars() {
        match c {
            '"' => in_quote = !in_quote,
            ' ' if !in_quote => {
                if !cur.is_empty() {
                    tokens.push(cur.clone());
                    cur.clear();
                }
            }
            _ => cur.push(c),
        }
    }
    if !cur.is_empty() {
        tokens.push(cur);
    }

    if tokens.is_empty() {
        return (cmd_str.to_string(), Vec::new());
    }

    let expanded: Vec<String> = tokens.into_iter().map(|t| expand_env_str(&t)).collect();
    let mut i = expanded.into_iter();
    let exe = i.next().unwrap();
    let args: Vec<String> = i.collect();
    (exe, args)
}

#[cfg(test)]
mod tests {
    use super::*;

    // -- parse_command --

    #[test]
    fn parse_command_simple() {
        let (exe, args) = parse_command("cmd.exe /c echo");
        assert_eq!(exe, "cmd.exe");
        assert_eq!(args, vec!["/c", "echo"]);
    }

    #[test]
    fn parse_command_quoted_path_with_spaces() {
        let (exe, args) =
            parse_command("\"C:\\Program Files\\app\\tool.exe\" -k \"arg with spaces\"");
        assert_eq!(exe, "C:\\Program Files\\app\\tool.exe");
        assert_eq!(args, vec!["-k", "arg with spaces"]);
    }

    #[test]
    fn parse_command_collapses_repeated_spaces() {
        let (exe, args) = parse_command("powershell.exe   -NoExit   -Command");
        assert_eq!(exe, "powershell.exe");
        assert_eq!(args, vec!["-NoExit", "-Command"]);
    }

    #[test]
    fn parse_command_no_args() {
        let (exe, args) = parse_command("wsl.exe");
        assert_eq!(exe, "wsl.exe");
        assert!(args.is_empty());
    }

    #[test]
    fn parse_command_empty_string_returns_input() {
        let (exe, args) = parse_command("");
        assert_eq!(exe, "");
        assert!(args.is_empty());
    }

    #[test]
    fn parse_command_unclosed_quote_consumes_rest() {
        let (exe, args) = parse_command("app.exe \"dangling quote");
        assert_eq!(exe, "app.exe");
        assert_eq!(args, vec!["dangling quote"]);
    }

    #[test]
    fn parse_command_expands_env_vars() {
        std::env::set_var("TTERM_TEST_TOOL", "mytool");
        let (exe, args) = parse_command("%TTERM_TEST_TOOL% --flag");
        assert_eq!(exe, "mytool");
        assert_eq!(args, vec!["--flag"]);
    }

    // -- expand_env_str --

    #[test]
    fn expand_env_existing_var() {
        std::env::set_var("TTERM_TEST_EXPAND", "expanded");
        assert_eq!(expand_env_str("%TTERM_TEST_EXPAND%"), "expanded");
    }

    #[test]
    fn expand_env_missing_var_kept_verbatim() {
        assert_eq!(
            expand_env_str("%TTERM_DEFINITELY_MISSING_VAR%"),
            "%TTERM_DEFINITELY_MISSING_VAR%"
        );
    }

    #[test]
    fn expand_env_multiple_vars_and_literal_text() {
        std::env::set_var("TTERM_TEST_A", "foo");
        std::env::set_var("TTERM_TEST_B", "bar");
        assert_eq!(
            expand_env_str("pre-%TTERM_TEST_A%-mid-%TTERM_TEST_B%-post"),
            "pre-foo-mid-bar-post"
        );
    }

    #[test]
    fn expand_env_no_percent_passthrough() {
        assert_eq!(expand_env_str("plain text"), "plain text");
    }
}
