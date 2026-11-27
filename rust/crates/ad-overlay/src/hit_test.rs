//! Stateless coordinate-based hit-testing for native click-through overlays.
//!
//! Because `WM_NCHITTEST` / `NSWindow` / `XShape` queries this table synchronously
//! for the current pointer position, empty pixels can never get wedged swallowing
//! game input due to missed DOM mouseleave events.

use ad_protocol::Rect;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HitRegion {
    pub id: String,
    pub rect: Rect,
}

#[derive(Debug, Default, Clone)]
pub struct HitTester {
    regions: Vec<HitRegion>,
    modal_active: bool,
}

impl HitTester {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn set_regions(&mut self, regions: Vec<HitRegion>) {
        self.regions = regions;
    }

    #[cfg_attr(not(test), allow(dead_code))]
    pub fn set_modal_active(&mut self, active: bool) {
        self.modal_active = active;
    }

    pub fn is_interactive(&self, x: i32, y: i32) -> bool {
        if self.modal_active {
            return true;
        }
        self.regions.iter().any(|region| {
            let right = region.rect.x.saturating_add_unsigned(region.rect.width);
            let bottom = region.rect.y.saturating_add_unsigned(region.rect.height);
            x >= region.rect.x && x < right && y >= region.rect.y && y < bottom
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_region() -> HitRegion {
        HitRegion {
            id: "controls".to_string(),
            rect: Rect {
                x: 100,
                y: 50,
                width: 200,
                height: 40,
            },
        }
    }

    #[test]
    fn empty_space_is_not_interactive() {
        let mut tester = HitTester::new();
        tester.set_regions(vec![sample_region()]);
        assert!(!tester.is_interactive(0, 0));
        assert!(!tester.is_interactive(99, 50));
        assert!(!tester.is_interactive(100, 49));
    }

    #[test]
    fn interior_and_top_left_edges_are_interactive() {
        let mut tester = HitTester::new();
        tester.set_regions(vec![sample_region()]);
        assert!(tester.is_interactive(100, 50));
        assert!(tester.is_interactive(200, 70));
        assert!(tester.is_interactive(299, 89));
    }

    #[test]
    fn right_and_bottom_edges_are_exclusive() {
        let mut tester = HitTester::new();
        tester.set_regions(vec![sample_region()]);
        assert!(!tester.is_interactive(300, 70));
        assert!(!tester.is_interactive(200, 90));
    }

    #[test]
    fn modal_active_captures_everywhere_and_clears_statelessly() {
        let mut tester = HitTester::new();
        assert!(!tester.is_interactive(500, 500));

        tester.set_modal_active(true);
        assert!(tester.is_interactive(500, 500));

        tester.set_modal_active(false);
        assert!(!tester.is_interactive(500, 500));
    }
}
