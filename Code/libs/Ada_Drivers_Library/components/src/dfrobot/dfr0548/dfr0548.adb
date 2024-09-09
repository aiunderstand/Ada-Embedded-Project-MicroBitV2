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
with Microbit.Console; use Microbit.Console;
use Microbit;
package body DFR0548 is

   procedure Assert_Status (Status : I2C_Status) is
   begin
      if Status /= Ok then
         Put_Line("I2C assert status fail, hard error");
         --  No error handling...
         raise Program_Error;
      end if;
   end Assert_Status;

   procedure Initialize (This : MotorDriver)
   is
      Status : I2C_Status;
   begin
      --RESET. Since volatile memory, reset to all zero.
      --Note power down/up cycle is needed for all values to be lost.
      --Or we do a softreset
      This.Port.Mem_Write_Buffer(Addr => 16#00#,
                          Data => (0 =>  SOFT_RESET),
                          Status => Status);


      This.Port.Mem_Write_Buffer(Addr => MOTORDRIVER_ADDRESS,
                                 Data => (0 =>  UInt8(MODE1),
                                          1 =>  16#00#),
                                 Status => Status);
   end Initialize;

   procedure Set_Frequency_Hz (This : MotorDriver;
                               Freq : Frequency) is
      Status : I2C_Status;
      prescaler : UInt8;

   begin
      --compute prescaler based on desired frequency
      --see formula p.25, 50Hz has a prescaler of 121 = 0x79
      prescaler := Compute_Prescaler_From_Frequency(Freq);

      --SLEEP. (set 4th bit high = 0x10) -> disable osc so we can write to prescale register (page 13-15)
      This.Port.Mem_Write_Buffer(Addr => MOTORDRIVER_ADDRESS,
                                 Data => (0 =>  UInt8(MODE1),
                                          1 =>  SLEEP),
                                 Status => Status);

      --SET PRESCALE.
      This.Port.Mem_Write_Buffer(Addr => MOTORDRIVER_ADDRESS,
                                 Data => (0 =>  UInt8(PRESCALE),
                                          1 =>  prescaler),
                                 Status => Status);


      --RESET & ENABLE AUTO INCREMENT. (bit 5 high, rest low)
      -- after this we need to be careful in sending bytes to hardware since auto increment is active
       This.Port.Mem_Write_Buffer(Addr => MOTORDRIVER_ADDRESS,
                                 Data => (0 =>  UInt8(MODE1),
                                          1 =>  START),
                                 Status => Status);




   end Set_Frequency_Hz;

   procedure Set_PWM_Wheels (This : MotorDriver;
                  rf : Wheel;
                  rb : Wheel;
                  lf : Wheel;
                  lb : Wheel)
    is
      Status : I2C_Status;
      Buffer : I2C_Data ( 0 .. 32 );
   begin
       Buffer (0) := UInt8(LED0_ON_L); -- start address
       Buffer (1 .. 8) := Convert_Wheel_PWM_Registers(rf);
       Buffer (9 .. 16) := Convert_Wheel_PWM_Registers(rb);
       Buffer (17 .. 24) := Convert_Wheel_PWM_Registers(lf);
       Buffer (25 .. 32) := Convert_Wheel_PWM_Registers(lb);

      This.Port.Mem_Write_Buffer(Addr => MOTORDRIVER_ADDRESS,
                                 Data => Buffer,
                                 Status => Status);

   end Set_PWM_Wheels;

   procedure Set_Servo (This : MotorDriver;
                        ServoPin: ServoPins;
                        Angle: Degrees)
   is
       Status : I2C_Status;
       Buffer : I2C_Data ( 0 .. 4 );
       Duty_Cycle: Float;
       PWM_Off: Float;
       Rounded_PWM_Off: UInt16;
   begin
       Duty_Cycle := ((Float(Angle) * 1800.0) / 180.0) + 600.0; -- input 0 - 180 = 600 - 2400 = 0.6ms - 2.4ms
       PWM_Off := (Duty_Cycle * 4096.0) / 20000.0; --between range 123 - 492
       Rounded_PWM_Off := UInt16(Float'Rounding(PWM_Off));

       Buffer (0) := UInt8(UInt8(LED15_ON_L) - ((UInt8(ServoPin-1)) * 4)); --register start address
       Buffer (1) := 0;
       Buffer (2) := 0;
       Buffer (3) := UInt8(Rounded_PWM_Off and 16#FF#); -- FORWARD OFF L
       Buffer (4) := UInt8(Shift_Right (Rounded_PWM_Off, 8)); -- FORWARD OFF H


       This.Port.Mem_Write_Buffer(Addr => MOTORDRIVER_ADDRESS,
                                 Data => Buffer,
                                 Status => Status);


   end Set_Servo;

   function Compute_Prescaler_From_Frequency(f : Frequency) return UInt8
   is
      Clock : constant Float := 25_000_000.0; --25 MHz
      Bits : constant Float := 4096.0; -- 12 bits
      Frequency : constant Float := Float(f);
   begin
      return UInt8(Float'Rounding(Clock / (Bits * Frequency)));
   end Compute_Prescaler_From_Frequency;

   function Convert_Wheel_PWM_Registers(w : Wheel) return I2C_Data
   is
      Buffer : I2C_Data ( 1.. 8 );
   begin
      if (w.SpeedForward = 0) and (w.SpeedBackward = 0) then -- Stop motor
         Buffer (1) := 16#00#;
         Buffer (2) := 16#00#;
         Buffer (3) := 16#00#;
         Buffer (4) := 16#00#;
         Buffer (5) := 16#00#;
         Buffer (6) := 16#00#;
         Buffer (7) := 16#00#;
         Buffer (8) := 16#00#;
      elsif w.SpeedForward > 0 then -- Set motor spinning forward
            -- set PWM signal at time X. Time X can be set for both ON and OFF part of the signal
            -- It is always ON at time 0 if value is 0, but it is OFF at time w.SpeedForward
            -- this means that if w.SpeedForward has value 0, then it is immediately off,
            -- and if it has the max value, 12bits is 4096 = FFF, then it is never off.
            Buffer (1) := 16#00#; --FORWARD ON L
            Buffer (2) := 16#00#; --FORWARD ON H
            Buffer (3) := UInt8(w.SpeedForward and 16#FF#); -- FORWARD OFF L
            Buffer (4) := UInt8(Shift_Right (UInt16(w.SpeedForward), 8)); -- FORWARD OFF H
            --
            Buffer (5) := 16#00#; -- BACKWARD ON L
            Buffer (6) := 16#00#; -- BACKWARD ON H
            Buffer (7) := 16#00#; -- BACKWARD OFF L
            Buffer (8) := 16#00#; -- BACKWARD OFF H


      else -- Set motor spinning backward
            Buffer (1) := 16#00#;
            Buffer (2) := 16#00#;
            Buffer (3) := 16#00#;
            Buffer (4) := 16#00#;

            Buffer (5) := 16#00#;
            Buffer (6) := 16#00#;
            Buffer (7) := UInt8(w.SpeedBackward and 16#FF#); -- FORWARD OFF L
            Buffer (8) := UInt8(Shift_Right (UInt16(w.SpeedBackward), 8)); -- FORWARD OFF H

         end if;

      return Buffer;

   end Convert_Wheel_PWM_Registers;

end DFR0548;
