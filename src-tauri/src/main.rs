// Windows'ta release derlemede ek bir konsol penceresi açılmasın.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    reqly_lib::run()
}
