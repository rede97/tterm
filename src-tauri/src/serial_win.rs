//! Windows DCB patch so hardware flow control matches PuTTY.
//!
//! `serialport` 4.9 maps `FlowControl::Hardware` to `RTS_CONTROL_ENABLE`
//! (RTS held high) + `fOutxCtsFlow`. PuTTY's RTS/CTS is
//! `RTS_CONTROL_HANDSHAKE` + `fOutxCtsFlow`, with `DTR_CONTROL_ENABLE`
//! so SetCommState does not drop DTR. We apply that DCB after open and
//! on a live switch to hardware — never going through ENABLE first.

use std::os::windows::io::RawHandle;

use windows::Win32::Devices::Communication::{GetCommState, SetCommState, DCB};
use windows::Win32::Foundation::HANDLE;

const DTR_CONTROL_ENABLE: u32 = 1;
const RTS_CONTROL_HANDSHAKE: u32 = 2;

// PuTTY SER_FLOW_RTSCTS bits on DCB._bitfield:
//   fOutxCtsFlow     bit 2
//   fDtrControl      bits 4-5  (ENABLE)
//   fOutX / fInX     bits 8-9  (clear — not XON/XOFF)
//   fRtsControl      bits 12-13 (HANDSHAKE)
pub(crate) fn putty_rtscts_bitfield(bitfield: u32) -> u32 {
    let mut b = bitfield;
    b |= 1 << 2;
    b &= !(0b11 << 4);
    b |= (DTR_CONTROL_ENABLE & 0b11) << 4;
    b &= !(1 << 8);
    b &= !(1 << 9);
    b &= !(0b11 << 12);
    b |= (RTS_CONTROL_HANDSHAKE & 0b11) << 12;
    b
}

pub(crate) fn apply_putty_hardware_dcb(handle: RawHandle) -> Result<(), String> {
    let h = HANDLE(handle);
    let mut dcb = DCB {
        DCBlength: std::mem::size_of::<DCB>() as u32,
        ..DCB::default()
    };
    unsafe { GetCommState(h, &mut dcb) }.map_err(|e| e.to_string())?;
    dcb._bitfield = putty_rtscts_bitfield(dcb._bitfield);
    unsafe { SetCommState(h, &dcb) }.map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn handshake_bits_match_putty() {
        let b = putty_rtscts_bitfield(0);
        assert_ne!(b & (1 << 2), 0, "fOutxCtsFlow");
        assert_eq!((b >> 4) & 0b11, DTR_CONTROL_ENABLE, "fDtrControl ENABLE");
        assert_eq!(b & (1 << 8), 0, "fOutX off");
        assert_eq!(b & (1 << 9), 0, "fInX off");
        assert_eq!(
            (b >> 12) & 0b11,
            RTS_CONTROL_HANDSHAKE,
            "fRtsControl HANDSHAKE"
        );
    }

    #[test]
    fn handshake_bits_clear_serialport_enable() {
        // serialport Hardware: RTS ENABLE (1) in bits 12-13, no DTR ENABLE.
        let serialport_hw = 1 << 2 | (1 << 12);
        let b = putty_rtscts_bitfield(serialport_hw);
        assert_eq!((b >> 12) & 0b11, RTS_CONTROL_HANDSHAKE);
        assert_eq!((b >> 4) & 0b11, DTR_CONTROL_ENABLE);
    }
}
