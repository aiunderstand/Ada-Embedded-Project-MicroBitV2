------------------------------------------------------------------------------
--                                                                          --
--                       Copyright (C) 2018, AdaCore                        --
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
with MicroBit.Console; use MicroBit.Console;
with MicroBit.IOs; use MicroBit.IOs;
with MicroBit.Time; use MicroBit.Time;
with MicroBit;

procedure Main is
   -- a range between 0 and 1023 meaning 0V to 3.3V
   Value : constant Analog_Value := 76;
begin
   -- To create an analog output signal we need frequency and amplitude
   
   --  We set the frequency by setting the period (remember f=1/t).
   Set_Analog_Period_Us(20000); -- 50 Hz = 1/50 = 0.02s = 20 ms = 20000us 
   
   --  To set the amplitude we use a trick called duty cycle. For example:
   --  A 100% duty cycle means a DC signal (always up), eg the frequency is 0, despite being set.
   --  A 50% duty cycle means on average 1.65V but it also means 50% the pulse is up at 3.3V and 50% the pulse is down at 0V.
   --  A 10% duty cycle means 10% of 3.3V = on average 0.33V: 10% up, 90% down.
   Write (0, Value);
   
   --  Wait 5 seconds
   Delay_Ms(5000);
   
   loop
	-- Generating PWM signal to control a servo motor without a motor library
   -- First look at the data sheet of the motor for example: https://components101.com/motors/mg995-servo-motor
	   
   -- The MG995 servo motor needs a 50 Hz frequency or 20 ms (already done above)
	-- The spec says a valid duty cycle is 0.5 ms/20ms = 2.5% (-90 degree) 
	--                                     1.5 ms/20ms = 7.5% ( 0 degree) 
	--                                     2.5 ms/20ms = 12.5% ( +90 degree) 
	  
   -- Loop for value between 25 = 2.5% of 1023 (3.3V) and 127 = 12.5% of 1023.
      for Angle in Analog_Value range 25.. 127 loop
         --Set new duty cycle
         Write (0, Angle);
     
         --Write result to Serial port
         Put_Line("Angle is: " & Angle'Image);
         
         --Wait 2 frames of 50Hz = 40ms (delay is always needed because a servo needs time to physically rotate. Delay depends on amount of rotation and rotation speed of servo) 
         Delay_Ms(40);
      end loop;
      
   end loop;
end Main;
