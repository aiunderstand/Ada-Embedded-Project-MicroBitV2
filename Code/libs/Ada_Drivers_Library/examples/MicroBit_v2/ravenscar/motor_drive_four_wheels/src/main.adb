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
with MicroBit.IOsForTasking;  use MicroBit.IOsForTasking;
with MicroBit;

procedure Main is
   Speed : constant Analog_Value := 512; --between 0 and 1023
   DriveForward       : Boolean := True; -- forward is true, backward is false
   
   UseLeftFrontWheel  : Boolean := True;
   UseLeftBackWheel   : Boolean := True;
   UseRightFrontWheel : Boolean := True;
   UseRightBackWheel  : Boolean := True;

begin
   --  This example requires you to wire 2 motor controllers such as the LN298 to 4 DC motors.
   --  The motor controllers can be powered by a 6V battery while the IO signals from the MB are 3.3V
   --  Wire the Microbit v2 pins to the pin assignments below. Carefully note the labels IN1, IN2, IN3, IN4, ENA, ENB and the assigned pins
   --  They differ from the left and right motor controller since they are physically mirrored on the car and now the wiring is easiest.

   --  Test routine: First Enable the LeftFrontWheel and leave DriveForward to true;
   --  Fix the wiring until the LeftFrontWheel drives forward.
   --  Then Disable and Enable LeftBackWheel and fix the wiring until it drives forward.
   --  Repeat for all wheels.
   --  Enable all wheels to see that the care is now moving forward.   
   --  Change Forward to False to and make sure it also drives backwards!
   
   --  Each wheel is controlled individually with PWM signals. 
   --  We set the frequency by setting the period (remember f=1/t) using Set_Analog_Period_Us.
   --  By setting up the period, we can now use analog Write to set the dutycycle of the Enable pins of the motorcontroller
   --  This allows to control the speed with 0% being off and 100% dutycycle (value 1023) being the fastest speed.
   --  To stop we set either Write(0) or both Pins to False. Better is setting both Write(0) and Pins to False otherwise the motor controller can produce a high pitched noise.

   --  There is a good chance all wheels spin at different speeds, despite all being set to 512.
   --  Calibrate the speed using the Calibrate example.
   Set_Analog_Period_Us (20_000); -- 50 Hz = 1/50 = 0.02s = 20 ms = 20000us

   --LEFT
   --front
   if UseLeftFrontWheel then
      Set (11, DriveForward); --IN3
      Set (12, not DriveForward); --IN4
      Write (0, Speed); -- ENB
   end if;

   --back
   if UseLeftBackWheel then
      Set (13, DriveForward); --IN1
      Set (14, not DriveForward); --IN2
      Write (1, Speed); -- ENA
   end if;

   --RIGHT
   --front
   if UseRightFrontWheel then
      Set (15, DriveForward); --IN1
      Set (16, not DriveForward); --IN2
      Write (2, Speed); -- ENA
   end if;

   --back
   if UseRightBackWheel then
      Set (19, DriveForward); --IN3
      Set (20, not DriveForward); --IN4
      Write (3, Speed); -- ENB
   end if;
   
   loop
      null; -- note that setting the period with Set_Analog_Period_Us
            -- and setting the dutycycle with Write allows the motors 
            -- to drive continuously
   end loop;
end Main;
