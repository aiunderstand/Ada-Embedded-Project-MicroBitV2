------------------------------------------------------------------------------
--                                                                          --
--                    Copyright (C) 2018-2019, AdaCore                      --
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

with MicroBit.IOs;     use MicroBit.IOs;
with MicroBit.Servos;  use MicroBit.Servos;
with MicroBit.Buttons; use MicroBit.Buttons;
with MicroBit.Time;    use MicroBit.Time;

procedure Main is
   -- this example requires you to wire two 2 servo motors to pin Microbit 1 and 2. It is recommended to power the servos's with 5V (check the spec sheet)
   -- while the IO signal from the microbit s 3.3V

   -- define the micro:bit v2 pins where 2 servo's are attached.
   subtype Servo_Pin_Id is Pin_Id range 1 .. 2;

   -- create a Servo_Pin_Array struct with embedded function Active to set the target angle of rotation
   type Servo_Pin_State (Active : Boolean := False) is record
      case Active is
         when True =>
            Setpoint : Servo_Set_Point;
         when False =>
            null;
      end case;
   end record;
   type Servo_Pin_Array is array (Servo_Pin_Id) of Servo_Pin_State;

   -- initialize all servo pins to have no PWM signal.
   Servo_Pins : Servo_Pin_Array := (others => (Active => False));

begin
   loop

      --  For all servo pins
      for J in Servo_Pins'Range loop

         -- If the servo is activated
         if Servo_Pins (J).Active then

            -- Library call to microbit-servos to set the duty cycle on a pin. Compare with the analog out example!
            Go (J, Servo_Pins (J).Setpoint);
         else
            -- Library call to microbit-servos to set the duty cycle to zero.
            Stop (J);

         end if;
      end loop;

      --  Check buttons
      -- If both buttons A and B are pressed, deactivate both servos. It is important to have a stop function when working with motors.
      if State (Button_A) = Pressed and then State (Button_B) = Pressed then
         Servo_Pins := (others => (Active => False));

         -- If button A is pressed, activate both and let them rotate opposite of eachother
      elsif State (Button_A) = Pressed then
         Servo_Pins :=
           (1 => (Active => True, Setpoint => 0),
            2 => (Active => True, Setpoint => 180));
         -- If button B is pressed, activate both and let them rotate opposite of eachother
      elsif State (Button_B) = Pressed then
         Servo_Pins :=
           (1 => (Active => True, Setpoint => 180),
            2 => (Active => True, Setpoint => 0));
      end if;

      --  Delay for at least 1 PWM frame (50Hz, so 20ms)
      Delay_Ms (20);

   end loop;
end Main;
