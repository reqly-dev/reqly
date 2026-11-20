// Windows'ta release derlemede ek bir konsol penceresi açılmasın.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    reqster_lib::run()
}
