------------------------------------------------------------------------------
--                                                                          --
--                       Copyright (C) 2020, AdaCore                        --
--                                                                          --
--  Redistribution and use in source and binary forms, with or without      --
--  modification, are permitted provided that the following conditions are  --
--  met:                                                                    --
--     1. Redistributions of source code must retain the above copyright    --
--        notice, this list of conditions and the following disclaimer.     --
--     2. Redistributions in binary form must reproduce the above copyright --
--        notice, this list of conditions and the following disclaimer in   --
--        the documentation and/or other materials provided with the        --
--        distribution.                                                     --
--     3. Neither the name of the copyright holder nor the names of its     --
--        contributors may be used to endorse or promote products derived   --
--        from this software without specific prior written permission.     --
--                                                                          --
--   THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS    --
--   "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT      --
--   LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR  --
--   A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT   --
--   HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, --
--   SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT       --
--   LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,  --
--   DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY  --
--   THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT    --
--   (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE  --
--   OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.   --
--                                                                          --
------------------------------------------------------------------------------
with HAL;     use HAL;
with HAL.I2C; use HAL.I2C;

--with Microbit.Console; use Microbit.Console;
package DFR0548 is

  type Register_Address is new UInt8;
  type Frequency is range 24 .. 1526; -- in Hz
  type PinId is range 0 .. 7;
  type ServoPins is range 1 .. 8;
  type Degrees is range 0 .. 180;

  type Wheel is record
      SpeedForward: UInt12;
      SpeedBackward: UInt12;
   end record;

  type MotorDriver (Port : not null Any_I2C_Port) is
     tagged limited private;

   procedure Assert_Status (Status : I2C_Status);

   procedure Initialize(This : MotorDriver);

   procedure Set_Frequency_Hz (This : MotorDriver;
                               Freq : Frequency);

   procedure Set_Servo (This : MotorDriver;
                        ServoPin: ServoPins;
                        Angle: Degrees);

   procedure Set_PWM_Wheels (This : MotorDriver;
                  rf : Wheel;
                  rb : Wheel;
                  lf : Wheel;
                  lb : Wheel);

   function Convert_Wheel_PWM_Registers(w : Wheel) return I2C_Data;

   function Compute_Prescaler_From_Frequency(f : Frequency) return UInt8; --we could use a range value from 0x03 to 0xFF but Freq is already ranged
private
   type MotorDriver (Port : not null Any_I2C_Port)
   is tagged limited null record;

   -- I2C Address: see page 8 https://www.nxp.com/docs/en/data-sheet/PCA9685.pdf
   -- A5A4A3A2A1A0 = 000000 results in 16#40# but, since 7 bits, needs a shift left
   -- (16#40# << 1) = 16#80#,

   MOTORDRIVER_ADDRESS   : constant I2C_Address := 16#80#;

   -- The (8-bit)g register addresses are on page 10
   MODE1 : constant Register_Address := 16#00#;
   PRESCALE : constant Register_Address := 16#FE#;
   LED0_ON_L : constant Register_Address := 16#06#; --start address motors (counting up)
   LED15_ON_L : constant Register_Address := 16#42#; --start address servos

   -- Commonly used register values
   SLEEP : constant UInt8 := 16#10#;
   START : constant UInt8 := 16#20#;
   SOFT_RESET  : constant UInt8 := 16#06#;

end DFR0548;
