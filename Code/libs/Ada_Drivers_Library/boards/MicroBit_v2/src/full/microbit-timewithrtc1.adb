--with Ada.Text_IO; use Ada.Text_IO;
with nRF.Clock;
with nRF.Device;        use nRF.Device;
with nRF.RTC;           use nRF.RTC;
with nRF.Events;
with nRF.Interrupts;
with Ada.Real_Time; use Ada.Real_Time;

package body MicroBit.TimeWithRTC1 is
 package Clocks renames nRF.Clock;

   procedure Delay_Ms (Ms : Integer) is
      --Wakeup_Time : constant UInt64 := Timer.Get_Clock + Milliseconds;
   begin
      -- NOTE THAT WE ARE NOW NOT USING RTC1, BUT RTC0.
      delay until Clock + Milliseconds(Ms);

      --while Wakeup_Time > Timer.Get_Clock loop
         --Asm (Template => "wfi", -- Wait for interrupt, note that this is a blocking call as the CPU will halt all execution
         --                        -- Using WFI saves power: https://developer.arm.com/documentation/ddi0406/b/System-Level-Architecture/The-System-Level-Programmers--Model/Exceptions/Wait-For-Interrupt?lang=en
         --     Volatile => True);
      --end loop;
   end Delay_Ms;

   --  ---------------
   --  -- HAL_Delay --
   --  ---------------
   --
   --  Delay_Instance : aliased MB_Delays;
   --
   --  function HAL_Delay return not null HAL.Time.Any_Delays is
   --  begin
   --     return Delay_Instance'Access;
   --  end HAL_Delay;
   --
   --  ------------------------
   --  -- Delay_Microseconds --
   --  ------------------------
   --
   --  overriding
   --  procedure Delay_Microseconds (This : in out MB_Delays;
   --                                Us   : Integer)
   --  is
   --     pragma Unreferenced (This);
   --  begin
   --     Delay_Ms (UInt64 (Us / 1000));
   --  end Delay_Microseconds;
   --
   --  ------------------------
   --  -- Delay_Milliseconds --
   --  ------------------------
   --
   --  overriding
   --  procedure Delay_Milliseconds (This : in out MB_Delays;
   --                                Ms   : Integer)
   --  is
   --     pragma Unreferenced (This);
   --  begin
   --     Delay_Ms (UInt64 (Ms));
   --  end Delay_Milliseconds;
   --
   --  -------------------
   --  -- Delay_Seconds --
   --  -------------------
   --
   --  overriding
   --  procedure Delay_Seconds (This : in out MB_Delays;
   --                           S    : Integer)
   --  is
   --     pragma Unreferenced (This);
   --  begin
   --     Delay_Ms (UInt64 (S * 1000));
   --  end Delay_Seconds;








   protected body Timer is
        --  procedures can modify the data
      procedure Initialize is
      begin
         if not
         Clocks.Low_Freq_Running then
         Clocks.Set_Low_Freq_Source (Clocks.LFCLK_SYNTH);
         Clocks.Start_Low_Freq;
         loop
            exit when Clocks.Low_Freq_Running;
         end loop;
      end if;

      Stop (RTC_1);

      --  1kHz
      Set_Prescaler (RTC_1, 0);
      Set_Compare (RTC_1, 0, 32);

      Enable_Event (RTC_1, Compare_0_Event);

      nRF.Events.Enable_Interrupt (nRF.Events.RTC_1_COMPARE_0);
      nRF.Interrupts.Enable (nRF.Interrupts.RTC1_Interrupt);

      Start (RTC_1);


      end Initialize;

       procedure Update_Clock is
      begin
         Clock_Ms := Clock_Ms + Period_Ms;

         --  if AlarmSet then
         --     if  Wakeup_Time < Clock_Ms then
         --        AlarmSet := False;
         --     end if;
         --  end if;

      end Update_Clock;

      procedure RTC1_IRQHandler is
      begin
      Stop (RTC_1);
      Clear (RTC_1);
      Start (RTC_1);

      nRF.Events.Clear (nRF.Events.RTC_1_COMPARE_0);
         Update_Clock;
         AlarmSet := True;

         for Subs of Subscribers loop

         if Subs /= null then
            --  Call the subscriber
            Subs.all;
         end if;
         end loop;
          --Put_Line ("Pressed Tick");
      end RTC1_IRQHandler;

       -----------------
   -- Tick_Period --
   -----------------

   function Tick_Period return Time_Ms is
   begin
      return Period_Ms;
   end Tick_Period;

   --------------------
   -- Tick_Subscribe --
   --------------------

   function Tick_Subscriber (Callback : not null Tick_Callback) return Boolean is
   begin
      for Subs of Subscribers loop
         if Subs = Callback then
            return True;
         end if;
      end loop;
      return False;
   end Tick_Subscriber;

   --------------------
   -- Tick_Subscribe --
   --------------------

   function Tick_Subscribe (Callback : not null Tick_Callback) return Boolean is
   begin
      for Subs of Subscribers loop
         if Subs = null then
            Subs := Callback;
            return True;
         end if;
      end loop;

      return False;
   end Tick_Subscribe;

   ----------------------
   -- Tick_Unsubscribe --
   ----------------------

   function Tick_Unsubscribe (Callback : not null Tick_Callback) return Boolean is
   begin
      for Subs of Subscribers loop
         if Subs = Callback then
            Subs := null;
            return True;
         end if;
      end loop;
      return False;
   end Tick_Unsubscribe;


      --  procedure Delay_Ms (Milliseconds : UInt64) is
      --     --      Wakeup_Time : UInt64 := Get_Clock + Milliseconds;
      --  begin
      --     Wakeup_Time := Get_Clock + Milliseconds;
      --     AlarmSet := True;
      --
      --     --  while AlarmSet loop
      --     --     null;
      --     --  end loop;
      --     --begin
      --     --  while Wakeup_Time > Get_Clock loop
      --     --  Put_Line ("Here");
      --     --     Put_Line ("Here: " & Integer'Image (Integer(Timer.Get_Clock)));
      --     --  Asm ("wfi", -- Wait for interrupt, note that this is a blocking call as the CPU will halt all execution
      --     --                          -- Using WFI saves power: https://developer.arm.com/documentation/ddi0406/b/System-Level-Architecture/The-System-Level-Programmers--Model/Exceptions/Wait-For-Interrupt?lang=en
      --     --       Volatile => True);
      --     --  delay 0.001;
      --
      --  --end loop;
      --  end Delay_Ms;

       --  functions cannot modify the data
      function Get_Clock return UInt64 is
      begin
         return Clock_Ms;
      end Get_Clock;

      function Get_AlarmSet return Boolean is
      begin
         return AlarmSet;
      end Get_AlarmSet;
   end Timer;
   begin
   Timer.Initialize;
end MicroBit.TimeWithRTC1;
