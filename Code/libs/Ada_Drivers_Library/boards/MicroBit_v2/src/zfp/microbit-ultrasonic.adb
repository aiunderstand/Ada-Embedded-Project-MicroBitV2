with MicroBit.Time.Highspeed; use MicroBit.Time.Highspeed;
with HAL;      use HAL;
package body MicroBit.Ultrasonic is
   Trigger : GPIO_Point;
   Echo  : GPIO_Point;

   --we use this setup function to prevent a dependency on Microbit.IOS
   procedure Initialize
   is
      Conf : GPIO_Configuration;
   begin
      Trigger := Trigger_Pin;
      Echo := Echo_Pin;

      Conf.Mode         := Mode_Out;
      Conf.Resistors    := No_Pull;
      Conf.Input_Buffer := Input_Buffer_Connect;
      Conf.Sense        := Sense_Disabled;

      --set trigger pin as output
      Trigger.Configure_IO (Conf);
      Trigger.Clear;

      --set echo pin as input
      Conf.Mode         := Mode_In;
      Echo.Configure_IO (Conf);
      Echo.Clear;
   end Initialize;

   function Read return Distance_cm is
      Result_in_cm : Distance_cm := 0;
   begin
      SendTriggerPulse; --blocking, but only 10 us
      Result_in_cm := WaitForEcho; --blocking, max 3 + 23 = 26 ms;

      return Result_in_cm;
   end Read;

   procedure SendTriggerPulse is
   begin
       -- Not 10 us, more about 11.4us (10 us+ required by ultrasonic spec)
      Trigger.Set;
      Delay_Us(10);
      Trigger.Clear;
      end SendTriggerPulse;

   function WaitForEcho return Distance_cm is
      IsTimeout : Boolean := False;
      Result_in_CM : Distance_cm := 0;
   begin
      --see polling example: https://learn.adacore.com/courses/intro-to-embedded-sys-prog/chapters/handling_interrupts.html#interrupt-handlers

      --wait for echo to start (should take about 200us to send 8x40KHz burst and after that it is set to high automatically by sensor)
      IsTimeout := Wait_For_Start_Blocking_Using_Polling_With_Timeout(3); --max 3 ms blocking wait

      --wait for echo to end
      if not IsTimeout then
         Result_in_CM := Wait_For_End_Blocking_Using_Polling_With_Timeout(23); --max 23 ms
      end if;

      return Result_in_CM;
   end WaitForEcho;

   function Wait_For_End_Blocking_Using_Polling_With_Timeout(Timeout_Ms : Time_Ms) return Distance_cm
   is
      Deadline : constant Time_Ms := Clock + Timeout_Ms;
      Result_in_CM :Distance_cm := 0;
   begin
      --use a named loop so we can call "exit named loop when" instead of "while .. "
   Polling: loop
         exit Polling when Echo.Set = False;
         -- Distance formula see: https://cdn.sparkfun.com/datasheets/Sensors/Proximity/HCSR04.pdf
         Delay_Us(58);  --wait for 58 us or 1 cm distance and check again
         Result_in_CM := Result_in_CM + 1;

         if Clock >= Deadline then
            Result_in_CM := 0;
            Echo.Set; --0 cm, NOTE: this cutoff threshold means that value is unusable
         end if;

   end loop Polling;

      return Result_in_CM;
end Wait_For_End_Blocking_Using_Polling_With_Timeout;

 function Wait_For_Start_Blocking_Using_Polling_With_Timeout  (Timeout_Ms : Time_Ms) return Boolean
is
      Deadline : constant Time_Ms := Clock + Timeout_Ms;
      IsTimeOut: Boolean := False;
   begin
      --use a named loop so we can call "exit named loop when" instead of "while .. "
   Polling: loop
      exit Polling when Echo.Set = True;
      if Clock >= Deadline then
            Echo.Clear;
            IsTimeOut := True;
      end if;
   end loop Polling;

      return IsTimeOut;
   end Wait_For_Start_Blocking_Using_Polling_With_Timeout;


begin
   Initialize;
end MicroBit.Ultrasonic;
