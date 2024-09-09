   package body MyMotorController is

   procedure Stop is
   begin
      DriveWheel(w => ((WheelLF.Pins.Forward, WheelLF.Pins.Backward, WheelLF.Pins.Speed), (False, False, 0, 1.0)));
      DriveWheel(w => ((WheelLB.Pins.Forward, WheelLB.Pins.Backward, WheelLB.Pins.Speed), (False, False, 0, 1.0)));
      DriveWheel(w => ((WheelRF.Pins.Forward, WheelRF.Pins.Backward, WheelRF.Pins.Speed), (False, False, 0, 1.0)));
      DriveWheel(w => ((WheelRB.Pins.Forward, WheelRB.Pins.Backward, WheelRB.Pins.Speed), (False, False, 0, 1.0)));
   end Stop;

   procedure Drive
     (LF : DriveParams; LB : DriveParams; RF : DriveParams; RB : DriveParams)
   is
      begin
         DriveWheel(w => ((WheelLF.Pins.Forward, WheelLF.Pins.Backward, WheelLF.Pins.Speed), (LF.Forward, LF.Backward, LF.Speed, LF.Scale)));
         DriveWheel(w => ((WheelLB.Pins.Forward, WheelLB.Pins.Backward, WheelLB.Pins.Speed), (LB.Forward, LB.Backward, LB.Speed, LB.Scale)));
         DriveWheel(w => ((WheelRF.Pins.Forward, WheelRF.Pins.Backward, WheelRF.Pins.Speed), (RF.Forward, RF.Backward, RF.Speed, RF.Scale)));
         DriveWheel(w => ((WheelRB.Pins.Forward, WheelRB.Pins.Backward, WheelRB.Pins.Speed), (RB.Forward, RB.Backward, RB.Speed, RB.Scale)));
   end Drive;

   procedure DriveWheel(w : Wheel) is
   begin
      Set (w.Pins.Forward, w.Params.Forward);
      Set (w.Pins.Backward, w.Params.Backward);
   
      if UseCalibration = True then
         Write (w.Pins.Speed, Norm(w.Params.Speed, w.Params.Scale));  
      else
         Write (w.Pins.Speed, 512);
      end if;
   end DriveWheel;
   
   procedure Setup (LF : DrivePins; LB : DrivePins; RF : DrivePins; RB : DrivePins) is
   begin
      WheelLF.Pins := LF;
      WheelLB.Pins := LB;
      WheelRF.Pins := RF;
      WheelRB.Pins := RB;

      Set_Analog_Period_Us (20_000); -- 50 Hz = 1/50 = 0.02s = 20 ms = 20000us
   end Setup;

   function Norm (Speed : Analog_Value; Scale : Float) return Analog_Value is
      Temp : Float := Float (Speed);
   begin
      --Round product to nearest integer
      Temp := Float'Rounding (Temp * Scale);

      --Ceil
      if Temp > 1_023.0 then
         Temp := 1_023.0;
      end if;

      --Floor
      if Temp < 0.0 then
         Temp := 0.0;
      end if;

      --Convert to analog value
      return Analog_Value (Temp);      
   end Norm;

end MyMotorController;
