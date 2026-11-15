#!/usr/bin/env python3
"""Talk to the NovaArduinoBridge firmware directly (no ROS) to calibrate and check wiring.

  nova_run encoders                     live encoder counts: turn each wheel exactly one
                                        revolution by hand -> that number is the CPR
  nova_run encoders --spin 120          drive both motors forward at PWM 120 for 2 s and
                                        check both encoders count up (wheels off the ground!)

Stop the robot stack first: only one program can hold the Arduino's serial port.
Protocol (ros_arduino_bridge): 'e' read encoders, 'r' reset them, 'o L R' raw PWM.
"""
import argparse
import sys
import time

try:
    import serial
except ImportError:
    sys.exit('pyserial missing: sudo apt install python3-serial')


def cmd(port, text):
    port.reset_input_buffer()
    port.write((text + '\r').encode())
    return port.readline().decode(errors='replace').strip()


def encoders(port):
    parts = cmd(port, 'e').split()
    if len(parts) != 2:
        raise RuntimeError(f'unexpected reply {parts!r}: is the NovaArduinoBridge firmware '
                           'flashed, at this baud rate?')
    return int(parts[0]), int(parts[1])


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('port', help='Arduino serial port, e.g. /dev/ttyUSB0')
    ap.add_argument('--baud', type=int, default=57600)
    ap.add_argument('--spin', type=int, metavar='PWM',
                    help='run both motors forward at this raw PWM (0-255) for 2 s')
    a = ap.parse_args()

    try:
        port = serial.Serial(a.port, a.baud, timeout=0.5)
    except serial.SerialException as e:
        sys.exit(f'cannot open {a.port}: {e}\n(robot stack still running? user not in the '
                 "'dialout' group?)")
    time.sleep(2.0)                 # opening the port resets most Arduinos
    try:
        encoders(port)
        cmd(port, 'r')
        if a.spin is not None:
            pwm = max(-255, min(255, a.spin))
            print(f'Both motors at PWM {pwm} for 2 s ...')
            cmd(port, f'o {pwm} {pwm}')
            end = time.time() + 2.0
            while time.time() < end:
                time.sleep(0.25)
                cmd(port, f'o {pwm} {pwm}')     # keep ahead of the firmware's auto-stop
            cmd(port, 'o 0 0')
            time.sleep(0.3)
            left, right = encoders(port)
            print(f'left {left:+d}   right {right:+d}')
            for name, v in (('left', left), ('right', right)):
                if v == 0:
                    print(f'  {name}: no counts: check that encoder\'s wiring (or the motor did not turn)')
                elif (v > 0) != (pwm > 0):
                    print(f'  {name}: counts went the wrong way: swap that encoder\'s A/B wires '
                          'or, if the wheel itself spun backwards, that motor\'s two wires')
                else:
                    print(f'  {name}: OK')
            return
        print('Encoders reset. Turn each wheel exactly ONE revolution forward by hand;')
        print('the count is the encoder CPR (enc_counts_per_rev). Ctrl-C to quit.\n')
        while True:
            left, right = encoders(port)
            print(f'\r  left {left:+8d}    right {right:+8d}   ', end='', flush=True)
            time.sleep(0.1)
    except KeyboardInterrupt:
        print()
    except RuntimeError as e:
        sys.exit(str(e))
    finally:
        try:
            port.write(b'o 0 0\r')
        except Exception:
            pass
        port.close()


if __name__ == '__main__':
    main()
